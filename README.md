# GitHub Secrets 批量同步工具

这个工具可以批量为您的所有GitHub仓库同步Action Secrets。

## 功能特点

- 自动获取用户下所有非fork仓库（包括私有仓库）
- 读取环境变量中以`SYNC_`开头的变量作为secrets
- 批量为所有仓库添加或更新这些secrets
- 支持私有仓库
- 错误处理和进度显示
- 使用ES模块格式

## 技术栈

- ES模块 (ESM)
- Node.js 18+
- node-fetch v3
- libsodium-wrappers (用于加密)

## 安装依赖

```bash
pnpm install
```

## 环境变量配置

在运行脚本之前，需要设置以下环境变量：

### 必需的环境变量

```bash
# GitHub Personal Access Token (需要repo权限)
GITHUB_TOKEN=github_pat_xxxxxxxxx

# GitHub用户名
GITHUB_USER=your_username
```

### 要同步的Secrets

所有以`SYNC_`开头的环境变量都会被同步到仓库中（去掉`SYNC_`前缀）：

```bash
# 这些变量会被同步为secrets
SYNC_API_KEY=your_api_key_value
SYNC_DATABASE_URL=your_database_url
SYNC_SECRET_TOKEN=your_secret_token
```

## 使用方法

### 方法1: 使用npm脚本

```bash
pnpm run sync-all
```

### 方法2: 直接运行

```bash
node sync-all-repos.js
```

### 方法3: 在PowerShell中设置环境变量并运行

```powershell
# 设置环境变量
$env:GITHUB_TOKEN="github_pat_xxxxxxxxx"
$env:GITHUB_USER="your_username"
$env:SYNC_API_KEY="your_api_key"
$env:SYNC_DATABASE_URL="your_database_url"

# 运行同步
pnpm run sync-all
```

## 工作流程

1. 工具会获取您GitHub账户下的所有非fork仓库
2. 扫描环境变量，找到所有以`SYNC_`开头的变量
3. 为每个仓库逐个设置这些secrets
4. 显示同步进度和结果统计

## 注意事项

- 确保您的GitHub Token有足够的权限（repo权限）
- 只会同步您拥有的仓库，不会操作您参与但不拥有的仓库
- 如果某个仓库没有启用Actions，设置secrets可能会失败
- 工具会自动处理API限制，在请求间添加小延迟

## 示例输出

```
GitHub Secrets 批量同步工具
==============================
用户: your_username

正在获取所有仓库...
已获取第 1 页，找到 5 个非fork仓库
总共找到 15 个非fork仓库

找到 3 个SYNC_开头的环境变量:
  - API_KEY: your_api_k...
  - DATABASE_URL: postgres://...
  - SECRET_TOKEN: abc123...

开始同步secrets到所有仓库...

正在同步仓库: my-awesome-project (私有)
  ✓ 成功设置 API_KEY
  ✓ 成功设置 DATABASE_URL
  ✓ 成功设置 SECRET_TOKEN

==============================
同步完成!
成功: 15 个仓库
失败: 0 个仓库
总计: 15 个仓库
同步的secrets: 3 个
```

## 故障排除

1. **权限错误**: 确保GitHub Token有repo权限
2. **仓库未启用Actions**: 某些仓库可能需要先启用GitHub Actions
3. **API限制**: 工具已内置延迟处理，如遇到限制请稍后重试
