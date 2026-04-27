#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const net = require('net');

const rootDir = path.resolve(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function checkPortInUse(port) {
  return new Promise((resolve) => {
    const testBind = (host) => new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', () => res(true));
      srv.once('listening', () => {
        srv.close();
        res(false);
      });
      srv.listen(port, host);
    });

    Promise.all([testBind('0.0.0.0'), testBind('127.0.0.1'), testBind('::1')])
      .then(results => resolve(results.some(inUse => inUse)));
  });
}

async function run() {
  console.log('\x1b[36m%s\x1b[0m', '=== Web Project Creator ===');
  console.log('此工具將從零開始建立一個全新的 Laravel + Docker + Vue 專案。');
  console.log('將根據您選擇的 Laravel 版本自動配置對應的 PHP 版本。\n');

  // 1. 問答
  let projectName;
  let projectPath;
  while (true) {
    projectName = (await question('Project Name [mii-system]: ')) || 'mii-system';
    projectPath = path.join(process.cwd(), projectName);

    if (fs.existsSync(projectPath)) {
      console.log(`\n\x1b[33m⚠️  警告：專案 "${projectName}" 已存在。\x1b[0m`);
      console.log(`\x1b[31m即將刪除以下資料：\x1b[0m`);
      console.log(`- 資料夾：${projectPath}`);
      console.log(`- 容器：${projectName}-app, ${projectName}-mysql, ${projectName}-nginx, ${projectName}-phpmyadmin`);
      const override = (await question(`確定要執行刪除並重新建立嗎？(y/N): `)).toLowerCase();
      if (override === 'y' || override === 'yes') {
        console.log('清理舊資料中...');
        try {
          if (fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
            execSync('docker compose down -v', { cwd: projectPath, stdio: 'ignore' });
          }
          execSync(`docker rm -f ${projectName}-app ${projectName}-mysql ${projectName}-nginx ${projectName}-phpmyadmin`, { stdio: 'ignore' });
        } catch (e) { }
        try {
          execSync(`rm -rf "${projectPath}"`);
          if (fs.existsSync(projectPath)) {
            // 如果因為權限問題刪不掉，動用 docker root 權限強制刪除
            execSync(`docker run --rm -v "${process.cwd()}":/workspace alpine rm -rf "/workspace/${projectName}"`);
          }
        } catch (e) {
          console.log(`\n\x1b[31m❌ 刪除資料夾失敗，請手動刪除 ${projectPath}\x1b[0m`);
          process.exit(1);
        }
        console.log(`✅ 已刪除舊資料夾與容器。\n`);
        break;
      } else {
        console.log('請輸入新的 Project Name。\n');
        continue;
      }
    }
    break;
  }

  // 動態選擇 Laravel 與 PHP 版本
  const laravelVersion = (await question('Laravel Version (e.g. 11, 12) [11]: ')) || '11';
  let phpVersion = '8.3'; // Laravel 11 default
  if (laravelVersion === '12' || laravelVersion === '13') {
    phpVersion = '8.4';
  } else if (laravelVersion === '10') {
    phpVersion = '8.2';
  }

  const dbName = (await question(`Database Name [${projectName}]: `)) || projectName;
  const dbUser = (await question('Database User [root]: ')) || 'root';
  const dbPassword = (await question('Database Password [secret]: ')) || 'secret';

  let dbPort;
  while (true) {
    dbPort = (await question('Database Port [3306]: ')) || '3306';
    if (isNaN(dbPort) || dbPort <= 0 || dbPort > 65535) {
      console.log('\x1b[31m❌ 錯誤：請輸入有效的 Port 號碼 (1-65535)\x1b[0m');
      continue;
    }
    if (await checkPortInUse(dbPort)) {
      console.log(`\x1b[31m❌ 錯誤：Port ${dbPort} 已經被佔用，請重新輸入一個新的 Port。\x1b[0m`);
      continue;
    }
    break;
  }

  let appPort;
  while (true) {
    appPort = (await question('App Port (Nginx) [8000]: ')) || '8000';
    if (isNaN(appPort) || appPort <= 0 || appPort > 65535) {
      console.log('\x1b[31m❌ 錯誤：請輸入有效的 Port 號碼 (1-65535)\x1b[0m');
      continue;
    }
    if (appPort === dbPort) {
      console.log(`\x1b[31m❌ 錯誤：App Port 不能與 Database Port (${dbPort}) 相同，請重新輸入一個新的 Port。\x1b[0m`);
      continue;
    }
    if (await checkPortInUse(appPort)) {
      console.log(`\x1b[31m❌ 錯誤：Port ${appPort} 已經被佔用，請重新輸入一個新的 Port。\x1b[0m`);
      continue;
    }
    break;
  }

  let pmaPort;
  while (true) {
    pmaPort = (await question('phpMyAdmin Port [8080]: ')) || '8080';
    if (isNaN(pmaPort) || pmaPort <= 0 || pmaPort > 65535) {
      console.log('\x1b[31m❌ 錯誤：請輸入有效的 Port 號碼 (1-65535)\x1b[0m');
      continue;
    }
    if (pmaPort === dbPort || pmaPort === appPort) {
      console.log(`\x1b[31m❌ 錯誤：phpMyAdmin Port 不能與其他 Port 相同，請重新輸入。\x1b[0m`);
      continue;
    }
    if (await checkPortInUse(pmaPort)) {
      console.log(`\x1b[31m❌ 錯誤：Port ${pmaPort} 已經被佔用，請重新輸入一個新的 Port。\x1b[0m`);
      continue;
    }
    break;
  }

  const adminEmail = (await question('Admin Email [admin@admin.com]: ')) || 'admin@admin.com';
  const adminPassword = (await question('Admin Password [password]: ')) || 'password';

  rl.close();

  console.log('\n\x1b[32m%s\x1b[0m', `🚀 開始建立全新專案至資料夾：${projectPath}`);
  console.log(`\x1b[36m採用配置：Laravel ${laravelVersion}.x 搭配 PHP ${phpVersion}\x1b[0m`);
  fs.mkdirSync(projectPath, { recursive: true });

  try {
    console.log(`\n[1/7] 正在下載 Laravel ${laravelVersion} (使用 PHP ${phpVersion} 環境)...`);
    // 使用純 php-cli 映像檔下載 composer 並建立專案，將 composer 裝到 /tmp 確保目錄為空
    const composerCmd = `apt-get update && apt-get install -y git unzip zip && curl -sS https://getcomposer.org/installer | php -- --install-dir=/tmp --filename=composer && /tmp/composer create-project laravel/laravel . "^${laravelVersion}.0"`;
    execSync(`docker run --rm -v "${projectPath}":/app -w /app php:${phpVersion}-cli sh -c "${composerCmd}"`, { stdio: 'inherit' });

    console.log('\n[2/7] 建立客製化 Docker 配置檔...');

    // 寫入 docker-compose.yml
    const dockerComposePath = path.join(projectPath, 'docker-compose.yml');
    const dockerComposeContent = `services:
  ${projectName}-nginx:
    image: nginx:alpine
    ports:
      - "${appPort}:80"
    volumes:
      - ./:/var/www/html
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - ${projectName}-app
    networks:
      - mii-network

  ${projectName}-app:
    build:
      context: .
      dockerfile: docker/php/Dockerfile
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    volumes:
      - ./:/var/www/html
      - ./docker/php/php.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - mii-network
    depends_on:
      - ${projectName}-mysql

  ${projectName}-mysql:
    image: mysql:8.4
    ports:
      - "${dbPort}:3306"
    environment:
      MYSQL_ROOT_PASSWORD: '${dbPassword}'
      MYSQL_DATABASE: '${dbName}'${dbUser !== 'root' ? `\n      MYSQL_USER: '${dbUser}'\n      MYSQL_PASSWORD: '${dbPassword}'` : ''}
    volumes:
      - mii-mysql:/var/lib/mysql
    networks:
      - mii-network

  ${projectName}-phpmyadmin:
    image: phpmyadmin/phpmyadmin
    ports:
      - "${pmaPort}:80"
    environment:
      PMA_HOST: ${projectName}-mysql
    depends_on:
      - ${projectName}-mysql
    networks:
      - mii-network

networks:
  mii-network:
    driver: bridge

volumes:
  mii-mysql:
    driver: local
`;
    fs.writeFileSync(dockerComposePath, dockerComposeContent);

    // 建立 docker 目錄與配置
    const dockerDir = path.join(projectPath, 'docker');
    const nginxDir = path.join(dockerDir, 'nginx');
    const phpDir = path.join(dockerDir, 'php');

    fs.mkdirSync(dockerDir);
    fs.mkdirSync(nginxDir);
    fs.mkdirSync(phpDir);

    fs.writeFileSync(path.join(nginxDir, 'default.conf'), `server {
    listen 80;
    index index.php index.html;
    server_name localhost;
    error_log  /var/log/nginx/error.log;
    access_log /var/log/nginx/access.log;
    root /var/www/html/public;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\\.php)(/.+)$;
        fastcgi_pass ${projectName}-app:9000;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
    }
}`);

    fs.writeFileSync(path.join(phpDir, 'Dockerfile'), `FROM php:${phpVersion}-fpm

RUN apt-get update && apt-get install -y \\
    git curl libpng-dev libonig-dev libxml2-dev zip unzip nodejs npm

RUN apt-get clean && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd

RUN pecl install redis && docker-php-ext-enable redis

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

RUN chown -R www-data:www-data /var/www/html

EXPOSE 9000
CMD ["php-fpm"]
`);

    fs.writeFileSync(path.join(phpDir, 'php.ini'), `upload_max_filesize = 100M
post_max_size = 100M
memory_limit = 256M
`);

    // 更新 .env
    const envPath = path.join(projectPath, '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace(/^#?\s*APP_NAME=.*/gm, `APP_NAME="${projectName}"`);
      envContent = envContent.replace(/^#?\s*DB_CONNECTION=.*/gm, `DB_CONNECTION=mysql`);
      envContent = envContent.replace(/^#?\s*DB_HOST=.*/gm, `DB_HOST=${projectName}-mysql`);
      envContent = envContent.replace(/^#?\s*DB_PORT=.*/gm, `DB_PORT=3306\nFORWARD_DB_PORT=${dbPort}`);
      envContent = envContent.replace(/^#?\s*DB_DATABASE=.*/gm, `DB_DATABASE=${dbName}`);
      envContent = envContent.replace(/^#?\s*DB_USERNAME=.*/gm, `DB_USERNAME=${dbUser}`);
      envContent = envContent.replace(/^#?\s*DB_PASSWORD=.*/gm, `DB_PASSWORD=${dbPassword}\nPMA_PORT=${pmaPort}`);
      fs.writeFileSync(envPath, envContent);
    }

    console.log('\n[3/7] 啟動專案專屬的 Docker 環境...');
    execSync('docker compose up -d --build', { cwd: projectPath, stdio: 'inherit' });

    console.log('\n[4/7] 安裝 Laravel Breeze (Vue / Inertia)...');
    execSync(`docker compose exec ${projectName}-app composer require laravel/breeze --dev`, { cwd: projectPath, stdio: 'inherit' });
    execSync(`docker compose exec ${projectName}-app php artisan breeze:install vue --dark --no-interaction`, { cwd: projectPath, stdio: 'inherit' });

    console.log('\n[5/7] 安裝權限與操作紀錄模組 (Spatie)...');
    try {
      execSync(`docker compose exec ${projectName}-app composer require spatie/laravel-permission spatie/laravel-activitylog`, { cwd: projectPath, stdio: 'inherit' });
    } catch (e) {
      console.log('⚠️ Composer 安裝過程遇到 Docker 檔案同步延遲，正在自動重試...');
      execSync(`docker compose exec ${projectName}-app composer require spatie/laravel-permission spatie/laravel-activitylog`, { cwd: projectPath, stdio: 'inherit' });
    }
    execSync(`docker compose exec ${projectName}-app php artisan vendor:publish --provider="Spatie\\\\Permission\\\\PermissionServiceProvider"`, { cwd: projectPath, stdio: 'inherit' });
    execSync(`docker compose exec ${projectName}-app php artisan vendor:publish --provider="Spatie\\\\Activitylog\\\\ActivitylogServiceProvider" --tag="activitylog-migrations"`, { cwd: projectPath, stdio: 'inherit' });

    console.log('\n[6/7] 執行資料庫遷移...');
    console.log('正在等待資料庫啟動 (約需 10~15 秒)...');
    const waitDbCmd = `php -r '$start=time(); while(time()-$start<60) { try { new PDO("mysql:host=${projectName}-mysql;port=3306", "${dbUser}", "${dbPassword}"); exit(0); } catch(Exception) { sleep(1); } } exit(1);'`;
    execSync(`docker compose exec ${projectName}-app ${waitDbCmd}`, { cwd: projectPath, stdio: 'inherit' });
    execSync(`docker compose exec ${projectName}-app php artisan migrate`, { cwd: projectPath, stdio: 'inherit' });

    console.log('\n[7/7] 編譯前端資源...');
    execSync(`docker compose exec ${projectName}-app npm install`, { cwd: projectPath, stdio: 'inherit' });
    execSync(`docker compose exec ${projectName}-app npm run build`, { cwd: projectPath, stdio: 'inherit' });

    console.log('\n\x1b[32m%s\x1b[0m', '🎉 全新系統建置完成！');
    console.log(`\n請切換至專案資料夾開始開發：`);
    console.log(`\x1b[36mcd ${projectName}\x1b[0m`);
    console.log(`\n預覽網站：http://localhost:${appPort}`);
    console.log(`資料庫管理 (phpMyAdmin)：http://localhost:${pmaPort}`);

  } catch (error) {
    console.error('\n\x1b[31m%s\x1b[0m', '❌ 自動安裝過程中發生錯誤：');
    console.error(error.message);
    console.log('\n您可以嘗試手動進入資料夾除錯。');
  }
}

run().catch(console.error);
