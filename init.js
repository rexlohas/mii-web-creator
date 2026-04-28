#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const net = require('net');

const rootDir = __dirname;

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
  const baseDir = path.join(rootDir, 'projects');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  console.log('\x1b[36m%s\x1b[0m', '=== Web Project Creator ===');
  console.log('此工具將從零開始建立一個全新的 Laravel + Docker + Vue 專案。');
  console.log('將根據您選擇的 Laravel 版本自動配置對應的 PHP 版本。\n');

  // 1. 問答
  let projectName;
  let projectPath;
  let state = null;
  let startStep = 1;

  while (true) {
    projectName = (await question('Project Name [mii-system]: ')) || 'mii-system';
    projectPath = path.join(baseDir, projectName);
    const statePath = path.join(baseDir, `.mii-setup-${projectName}.json`);

    if (fs.existsSync(projectPath)) {
      if (fs.existsSync(statePath)) {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        console.log(`\n\x1b[33m⚠️  發現專案 "${projectName}" 有未完成的安裝紀錄 (上次中斷於步驟 ${state.step}/7)。\x1b[0m`);
        const action = (await question(`請選擇動作：\n[c] 繼續上次的安裝 (Continue)\n[d] 刪除並重新安裝 (Delete)\n[q] 重新輸入專案名稱 (Quit)\n請選擇 (c/d/q) [c]: `)).toLowerCase() || 'c';

        if (action === 'c') {
          startStep = state.step;
          break;
        } else if (action === 'q') {
          console.log('請輸入新的 Project Name。\n');
          continue;
        }
      } else {
        console.log(`\n\x1b[33m⚠️  警告：專案 "${projectName}" 已存在。\x1b[0m`);
        console.log(`\x1b[31m即將刪除以下資料：\x1b[0m`);
        console.log(`- 資料夾：${projectPath}`);
        console.log(`- 容器：${projectName}-app, ${projectName}-mysql, ${projectName}-nginx, ${projectName}-phpmyadmin`);
        const override = (await question(`確定要執行刪除並重新建立嗎？(y/N): `)).toLowerCase();
        if (override !== 'y' && override !== 'yes') {
          console.log('請輸入新的 Project Name。\n');
          continue;
        }
      }

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
          execSync(`docker run --rm -v "${baseDir}":/workspace alpine rm -rf "/workspace/${projectName}"`);
        }
      } catch (e) {
        console.log(`\n\x1b[31m❌ 刪除資料夾失敗，請手動刪除 ${projectPath}\x1b[0m`);
        process.exit(1);
      }
      console.log(`✅ 已刪除舊資料夾與容器。\n`);
      state = null;
      startStep = 1;
      break;
    }
    break;
  }

  let laravelVersion, phpVersion, dbName, dbUser, dbPassword, dbPort, appPort, pmaPort, adminEmail, adminPassword;

  if (state) {
    laravelVersion = state.laravelVersion;
    phpVersion = state.phpVersion;
    dbName = state.dbName;
    dbUser = state.dbUser;
    dbPassword = state.dbPassword;
    dbPort = state.dbPort;
    appPort = state.appPort;
    pmaPort = state.pmaPort;
    adminEmail = state.adminEmail;
    adminPassword = state.adminPassword;
  } else {
    // 動態選擇 Laravel 與 PHP 版本
    laravelVersion = (await question('Laravel Version (e.g. 11, 12) [12]: ')) || '12';
    phpVersion = '8.3'; // Laravel 11 default
    if (laravelVersion === '12' || laravelVersion === '13') {
      phpVersion = '8.4';
    } else if (laravelVersion === '10') {
      phpVersion = '8.2';
    }

    dbName = (await question(`Database Name [${projectName}]: `)) || projectName;
    dbUser = (await question('Database User [root]: ')) || 'root';
    dbPassword = (await question('Database Password [secret]: ')) || 'secret';

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

    adminEmail = (await question('Admin Email [admin@admin.com]: ')) || 'admin@admin.com';
    adminPassword = (await question('Admin Password [password]: ')) || 'password';
  }

  rl.close();

  const statePath = path.join(baseDir, `.mii-setup-${projectName}.json`);
  function saveState(step) {
    fs.writeFileSync(statePath, JSON.stringify({
      projectName, projectPath, laravelVersion, phpVersion, dbName, dbUser, dbPassword, dbPort, appPort, pmaPort, adminEmail, adminPassword, step
    }, null, 2));
  }

  console.log('\n\x1b[32m%s\x1b[0m', `🚀 開始建立全新專案至資料夾：${projectPath}`);
  console.log(`\x1b[36m採用配置：Laravel ${laravelVersion}.x 搭配 PHP ${phpVersion}\x1b[0m`);

  if (startStep === 1) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  try {
    if (startStep <= 1) {
      saveState(1);
      console.log(`\n[1/7] 正在下載 Laravel ${laravelVersion} (使用 PHP ${phpVersion} 環境)...`);
      // 使用純 php-cli 映像檔下載 composer 並建立專案，將 composer 裝到 /tmp 確保目錄為空
      const composerCmd = `apt-get update && apt-get install -y git unzip zip && curl -sS https://getcomposer.org/installer | php -- --install-dir=/tmp --filename=composer && /tmp/composer create-project laravel/laravel . "^${laravelVersion}.0"`;
      execSync(`docker run --rm -v "${projectPath}":/app -w /app php:${phpVersion}-cli sh -c "${composerCmd}"`, { stdio: 'inherit' });
    }

    if (startStep <= 2) {
      saveState(2);
      console.log('\n[2/7] 建立客製化 Docker 配置檔...');

      // 寫入 docker-compose.yml
      const dockerComposePath = path.join(projectPath, 'docker-compose.yml');
      const dbUserConfig = dbUser !== 'root' ? `\n      MYSQL_USER: '${dbUser}'\n      MYSQL_PASSWORD: '${dbPassword}'` : '';
      let dockerComposeContent = fs.readFileSync(path.join(rootDir, 'templates', 'docker', 'docker-compose.yml.stub'), 'utf8');
      dockerComposeContent = dockerComposeContent
        .replace(/\{\{projectName\}\}/g, projectName)
        .replace(/\{\{appPort\}\}/g, appPort)
        .replace(/\{\{dbPort\}\}/g, dbPort)
        .replace(/\{\{dbPassword\}\}/g, dbPassword)
        .replace(/\{\{dbName\}\}/g, dbName)
        .replace(/\{\{DB_USER_CONFIG\}\}/g, dbUserConfig)
        .replace(/\{\{pmaPort\}\}/g, pmaPort);
      fs.writeFileSync(dockerComposePath, dockerComposeContent);

      // 建立 docker 目錄與配置
      const dockerDir = path.join(projectPath, 'docker');
      const nginxDir = path.join(dockerDir, 'nginx');
      const phpDir = path.join(dockerDir, 'php');

      if (!fs.existsSync(dockerDir)) fs.mkdirSync(dockerDir);
      if (!fs.existsSync(nginxDir)) fs.mkdirSync(nginxDir);
      if (!fs.existsSync(phpDir)) fs.mkdirSync(phpDir);

      let nginxContent = fs.readFileSync(path.join(rootDir, 'templates', 'docker', 'nginx', 'default.conf.stub'), 'utf8');
      nginxContent = nginxContent.replace(/\{\{projectName\}\}/g, projectName);
      fs.writeFileSync(path.join(nginxDir, 'default.conf'), nginxContent);

      let dockerfileContent = fs.readFileSync(path.join(rootDir, 'templates', 'docker', 'php', 'Dockerfile.stub'), 'utf8');
      dockerfileContent = dockerfileContent.replace(/\{\{phpVersion\}\}/g, phpVersion);
      fs.writeFileSync(path.join(phpDir, 'Dockerfile'), dockerfileContent);

      const phpIniContent = fs.readFileSync(path.join(rootDir, 'templates', 'docker', 'php', 'php.ini.stub'), 'utf8');
      fs.writeFileSync(path.join(phpDir, 'php.ini'), phpIniContent);

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
    }

    if (startStep <= 3) {
      saveState(3);
      console.log('\n[3/7] 啟動專案專屬的 Docker 環境...');
      execSync('docker compose up -d --build', { cwd: projectPath, stdio: 'inherit' });
    }

    if (startStep <= 4) {
      saveState(4);
      console.log('\n[4/7] 安裝 Laravel Breeze (Vue / Inertia)...');
      execSync(`docker compose exec ${projectName}-app composer require laravel/breeze --dev`, { cwd: projectPath, stdio: 'inherit' });
      execSync(`docker compose exec ${projectName}-app php artisan breeze:install vue --dark --no-interaction`, { cwd: projectPath, stdio: 'inherit' });
    }

    if (startStep <= 5) {
      saveState(5);
      console.log('\n[5/7] 安裝權限與操作紀錄模組 (Spatie)...');
      try {
        execSync(`docker compose exec ${projectName}-app composer require spatie/laravel-permission spatie/laravel-activitylog`, { cwd: projectPath, stdio: 'inherit' });
      } catch (e) {
        console.log('⚠️ Composer 安裝過程遇到 Docker 檔案同步延遲，正在自動重試...');
        execSync(`docker compose exec ${projectName}-app composer require spatie/laravel-permission spatie/laravel-activitylog`, { cwd: projectPath, stdio: 'inherit' });
      }
      execSync(`docker compose exec ${projectName}-app php artisan vendor:publish --provider="Spatie\\\\Permission\\\\PermissionServiceProvider"`, { cwd: projectPath, stdio: 'inherit' });
      execSync(`docker compose exec ${projectName}-app php artisan vendor:publish --provider="Spatie\\\\Activitylog\\\\ActivitylogServiceProvider" --tag="activitylog-migrations"`, { cwd: projectPath, stdio: 'inherit' });

      console.log('配置 User Model 加入 Spatie HasRoles 特性...');
      const userModelPath = path.join(projectPath, 'app', 'Models', 'User.php');
      if (fs.existsSync(userModelPath)) {
        let userContent = fs.readFileSync(userModelPath, 'utf8');
        if (!userContent.includes('use Spatie\\Permission\\Traits\\HasRoles;')) {
          userContent = userContent.replace(/use Illuminate\\Foundation\\Auth\\User as Authenticatable;/, "use Illuminate\\Foundation\\Auth\\User as Authenticatable;\nuse Spatie\\Permission\\Traits\\HasRoles;");
          userContent = userContent.replace(/use HasFactory, Notifiable;/, "use HasFactory, Notifiable, HasRoles;");
          fs.writeFileSync(userModelPath, userContent);
        }
      }
    }

    if (startStep <= 6) {
      saveState(6);
      console.log('\n[6/7] 執行資料庫遷移...');
      console.log('正在等待資料庫啟動 (約需 10~15 秒)...');
      const waitDbCmd = `php -r '$start=time(); while(time()-$start<60) { try { new PDO("mysql:host=${projectName}-mysql;port=3306", "${dbUser}", "${dbPassword}"); exit(0); } catch(Exception) { sleep(1); } } exit(1);'`;
      execSync(`docker compose exec ${projectName}-app ${waitDbCmd}`, { cwd: projectPath, stdio: 'inherit' });
      execSync(`docker compose exec ${projectName}-app php artisan migrate`, { cwd: projectPath, stdio: 'inherit' });

      console.log('正在建立預設管理員帳號...');
      let createAdminPhp = fs.readFileSync(path.join(rootDir, 'templates', 'backend', 'create_admin.php.stub'), 'utf8');
      createAdminPhp = createAdminPhp
        .replace(/\{\{adminEmail\}\}/g, adminEmail)
        .replace(/\{\{adminPassword\}\}/g, adminPassword);
      fs.writeFileSync(path.join(projectPath, 'create_admin.php'), createAdminPhp);
      execSync(`docker compose exec ${projectName}-app php create_admin.php`, { cwd: projectPath, stdio: 'ignore' });
      fs.unlinkSync(path.join(projectPath, 'create_admin.php'));
    }

    if (startStep <= 7) {
      saveState(7);
      console.log('\n[7/7] 編譯前端資源...');
      execSync(`docker compose exec ${projectName}-app npm install`, { cwd: projectPath, stdio: 'inherit' });
      execSync(`docker compose exec ${projectName}-app npm run build`, { cwd: projectPath, stdio: 'inherit' });
    }

    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    console.log('\n\x1b[32m%s\x1b[0m', '🎉 全新系統建置完成！');
    console.log(`\n請切換至專案資料夾開始開發：`);
    console.log(`\x1b[36mcd ${projectName}\x1b[0m`);
    console.log(`\n預覽網站：http://localhost:${appPort}`);
    console.log(`資料庫管理 (phpMyAdmin)：http://localhost:${pmaPort}`);

  } catch (error) {
    console.error('\n\x1b[31m%s\x1b[0m', '❌ 自動安裝過程中發生錯誤：');
    console.error(error.message);
    console.log('\n您可以嘗試手動進入資料夾除錯。下次執行時，您可以選擇從中斷的步驟繼續安裝。');
  }
}

run().catch(console.error);
