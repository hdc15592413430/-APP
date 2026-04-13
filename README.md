# 高考志愿辅助顾问 MVP

这个仓库现在已经不是“只能在你电脑上跑的想法”，而是一个可以继续往“真正应用”推进的原型。

当前包含两部分：

- `apps/mobile`
  Expo 手机端，负责顾问式问答、推荐结果、风格化分析
- `services/api`
  FastAPI 后端，负责推荐逻辑、数据读取、风格层调用

## 现在为什么还需要同一 Wi-Fi

如果你现在是这样跑的：

- 手机用 `Expo Go`
- 前端用 `expo start`
- 后端跑在你电脑本机

那手机必须同时能访问：

1. 你电脑上的 Expo 开发服务
2. 你电脑上的 FastAPI 接口

所以本地联调时，同一 Wi-Fi 最省事。

但这不代表产品以后只能这样用。接下来要做的是：

- 把后端部署到公网
- 把手机端改成请求公网 API
- 最后再把 Expo 调试形态换成真正可安装的 App

## 本地开发

### 1. 启动后端

```powershell
cd services/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn run:app --reload --host 0.0.0.0 --port 8000
```

如果你要继续用本地 OpenClaw：

```powershell
$env:STYLE_MODE="openclaw"
$env:OPENCLAW_AGENT="main"
python -m uvicorn run:app --reload --host 0.0.0.0 --port 8000
```

### 2. 启动前端

```powershell
cd apps/mobile
npm install
```

本地同一 Wi-Fi 联调：

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="http://192.168.1.23:8000"
npm run start:clear
```

如果你只是不想让手机和电脑必须同一 Wi-Fi，可以先试：

```powershell
npm run start:tunnel
```

注意：

- `start:tunnel` 只解决 Expo 开发服务的联网方式
- 如果后端还是你电脑本机，手机依然得能访问你电脑上的 API
- 真正完全摆脱同一 Wi-Fi，要把后端部署到公网

## 后端公网部署

### 推荐路线：先用 Render

对你现在这个阶段，我建议先用 Render。

原因是：

- 它对新手更友好
- 我已经给你准备好了 [render.yaml](</E:\郝东晨\Documents\New project\render.yaml>)
- 你不需要先自己配 Linux 服务器
- 用 GitHub 仓库直接就能部署

### 这一步做完后，你能得到什么

做完以后，手机端就不需要再去找你电脑的局域网 IP，而是直接请求：

`https://你的后端域名`

这时候即使你和用户不在同一个 Wi-Fi，也能拿到推荐结果。

### 后端现在已经支持的部署骨架

我已经补好了这些文件：

- [services/api/start.py](</E:\郝东晨\Documents\New project\services\api\start.py>)
- [services/api/Dockerfile](</E:\郝东晨\Documents\New project\services\api\Dockerfile>)
- [services/api/.dockerignore](</E:\郝东晨\Documents\New project\services\api\.dockerignore>)
- [services/api/.env.example](</E:\郝东晨\Documents\New project\services\api\.env.example>)
- [services/api/app/settings.py](</E:\郝东晨\Documents\New project\services\api\app\settings.py>)
- [render.yaml](</E:\郝东晨\Documents\New project\render.yaml>)

这些文件的作用分别是：

- `start.py`
  统一读取环境变量后启动服务，适合本地和云端都共用
- `Dockerfile`
  直接给 Railway / Render / Fly.io / 云服务器容器部署用
- `.env.example`
  告诉你线上要配哪些环境变量
- `settings.py`
  统一管理 `PORT`、`CORS`、`PUBLIC_BASE_URL` 这些部署配置
- `render.yaml`
  告诉 Render 直接从这个仓库把 `services/api` 作为 Docker Web Service 部署出去

### Render 部署步骤

1. 把当前项目推到 GitHub
2. 登录 [Render](https://render.com/)
3. 选择 `New +` -> `Blueprint`
4. 连接你的 GitHub 仓库
5. Render 会自动识别根目录里的 `render.yaml`
6. 创建服务后，在环境变量里补上：

```text
PUBLIC_BASE_URL=https://你的-render-域名
```

如果你后面有真实数据，再补：

```text
ADMISSIONS_DATA_FILE=/opt/render/project/src/services/api/app/data/your-real-data.json
```

第一次建议先这样：

- `STYLE_MODE=mock`
- 跑通公网推荐接口
- 等后面你把风格层服务化，再切真实模型

### Render 部署成功后怎么验证

打开：

```text
https://你的域名/health
```

正常应该看到类似：

```json
{
  "status": "ok",
  "environment": "production",
  "public_api_ready": true
}
```

### 你后端最少要配的环境变量

参考 [services/api/.env.example](</E:\郝东晨\Documents\New project\services\api\.env.example>)：

```env
APP_ENV=production
PORT=8000
PUBLIC_BASE_URL=https://api.your-domain.com
STYLE_MODE=mock
CORS_ALLOW_ORIGINS=*
```

当前建议：

- 云端先用 `STYLE_MODE=mock`
- 等你后面把风格层服务化，再把真实模型链路接到云端

原因很简单：你现在的 `openclaw` 还是跑在你电脑上的，本地好用，但不适合直接拿去云端容器里跑。

### Docker 启动方式

在 `services/api` 目录下：

```powershell
docker build -t gaokao-api .
docker run -p 8000:8000 --env-file .env gaokao-api
```

如果你用的是 Railway / Render 这类平台，直接把 `services/api` 指到它们的 Docker 部署入口就行。

## 手机端如何切到公网接口

我已经补好了：

- [apps/mobile/apiConfig.ts](</E:\郝东晨\Documents\New project\apps\mobile\apiConfig.ts>)
- [apps/mobile/.env.example](</E:\郝东晨\Documents\New project\apps\mobile\.env.example>)

现在手机端接口地址规则是：

1. 如果你手动设置了 `EXPO_PUBLIC_API_BASE_URL`
   就优先用这个
2. 如果没设置，而且还在开发模式
   就默认回退到 `http://127.0.0.1:8000`
3. 如果是正式环境又没设置
   App 会直接提示你“还没配置接口地址”

### 本地接口示例

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.23:8000
```

### 公网接口示例

```env
EXPO_PUBLIC_API_BASE_URL=https://api.your-domain.com
```

设置完以后重新启动前端：

```powershell
cd apps/mobile
npm run start:clear
```

如果这时你还在用 `Expo Go` 做开发预览，但又不想和电脑处于同一 Wi-Fi，可以配合：

```powershell
npm run start:tunnel
```

这时候：

- Expo 预览走 tunnel
- 后端走公网 API

你就不需要再靠“手机和电脑同一个 Wi-Fi”才能预览了。

## 做成真正可安装的 App

这一步不是今天必须完成，但方向已经准备好了。

我已经补了：

- [apps/mobile/eas.json](</E:\郝东晨\Documents\New project\apps\mobile\eas.json>)

这表示项目已经开始往 Expo EAS 构建的方向准备。

后面你要真正摆脱 `Expo Go` 和“同一 Wi-Fi”的最后一步，会是：

1. 后端先上公网
2. `EXPO_PUBLIC_API_BASE_URL` 指向公网 API
3. 用 EAS 构建安卓安装包
4. 用户直接装 App 使用

到那一步，手机就不需要再连你电脑，更不需要和你处于同一个 Wi-Fi。

## 真实数据

现在推荐引擎已经支持从 JSON 读数据，默认文件是：

- [services/api/app/data/admissions.demo.json](</E:\郝东晨\Documents\New project\services\api\app\data\admissions.demo.json>)

如果你有真实数据，可以通过环境变量切换：

```powershell
$env:ADMISSIONS_DATA_FILE="E:\path\to\your\real-admissions.json"
```

## 当前这一步最重要的结论

你现在已经从“本地原型”进入“应用工程化第一步”了。

这一步完成后，下一步最值得做的是：

1. 把后端真的部署到一个公网地址
2. 把手机端改成用这个公网地址
3. 再继续做 EAS 打包

如果你愿意，我下一步可以继续直接带你做：

**“把这个后端部署到一个最简单的云平台，并把前端切到公网 API。”**
