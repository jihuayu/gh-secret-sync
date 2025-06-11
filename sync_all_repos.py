import os
import sys
import base64
import requests
from nacl.public import SealedBox, PublicKey
import json
import time

# 从环境变量获取GitHub配置
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_USER = os.environ.get('GITHUB_USER')

if not GITHUB_TOKEN or not GITHUB_USER:
    print('错误: 请设置GITHUB_TOKEN和GITHUB_USER环境变量')
    print('GITHUB_TOKEN: GitHub Personal Access Token (需要repo权限)')
    print('GITHUB_USER: GitHub用户名')
    sys.exit(1)

API_BASE = 'https://api.github.com'

# 请求头
headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json'
}


def get_all_user_repos():
    print('正在获取所有仓库...')
    repos = []
    page = 1
    
    while True:
        try:
            url = f'{API_BASE}/user/repos?per_page=100&page={page}&type=all'
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            
            data = response.json()
            if not data:
                break
                
            # 过滤掉fork的仓库，只保留用户自己的仓库
            own_repos = [repo for repo in data 
                         if not repo['fork'] and repo['owner']['login'] == GITHUB_USER]
            
            repos.extend(own_repos)
            print(f'已获取第 {page} 页，找到 {len(own_repos)} 个非fork仓库')
            page += 1
            
        except requests.exceptions.RequestException as e:
            print(f'获取第 {page} 页仓库时出错: {str(e)}')
            raise
    
    print(f'总共找到 {len(repos)} 个非fork仓库')
    return repos


def get_sync_secrets():
    sync_secrets = []
    for key, value in os.environ.items():
        if not key.startswith('SYNC_'):
            continue
            
        # 验证secret值
        if not value or not isinstance(value, str) or not value.strip():
            print(f'警告: 跳过无效的环境变量 {key} (值为空或无效)')
            continue
            
        secret_name = key.replace('SYNC_', '', 1)
        sync_secrets.append({
            'name': secret_name,
            'value': value.strip()
        })
    
    print(f'找到 {len(sync_secrets)} 个有效的SYNC_开头的环境变量:')
    for secret in sync_secrets:
        print(f'  - {secret["name"]}: **********')  # 不输出实际值以保护隐私
    
    return sync_secrets


def set_repo_secret(owner, repo_name, secret_name, secret_value):
    try:
        # 验证输入参数
        if not secret_value or not isinstance(secret_value, str):
            raise ValueError(f'Secret值无效: {secret_name} = {secret_value}')
        
        # 1. 获取仓库的公钥
        pub_key_url = f'{API_BASE}/repos/{owner}/{repo_name}/actions/secrets/public-key'
        response = requests.get(pub_key_url, headers=headers)
        response.raise_for_status()
        public_key = response.json()
        
        # 验证公钥数据
        if 'key' not in public_key or 'key_id' not in public_key:
            raise ValueError(f'公钥数据无效: {public_key}')
        
        # 2. 使用公钥加密secret值
        try:
            # 打印调试信息
            print(f'  [调试] 加密 {secret_name}, 值长度: {len(secret_value)}, 公钥前20字符: {public_key["key"][:20]}...')
            
            # 使用PyNaCl加密
            public_key_obj = PublicKey(public_key['key'].encode('utf-8'))
            sealed_box = SealedBox(public_key_obj)
            encrypted = sealed_box.encrypt(secret_value.encode('utf-8'))
            encrypted_value = base64.b64encode(encrypted).decode('utf-8')
            
            # 验证加密结果
            if not encrypted_value:
                raise ValueError('加密结果为空')
                
        except Exception as crypto_error:
            raise ValueError(f'加密失败: {str(crypto_error)} (secret: {secret_name})')
        
        # 3. 设置或更新secret
        secret_url = f'{API_BASE}/repos/{owner}/{repo_name}/actions/secrets/{secret_name}'
        payload = {
            'encrypted_value': encrypted_value,
            'key_id': public_key['key_id']
        }
        
        response = requests.put(secret_url, headers=headers, json=payload)
        response.raise_for_status()
        
        print(f'  ✓ 成功设置 {secret_name}')
        
    except Exception as e:
        print(f'  ✗ 设置 {secret_name} 失败: {str(e)}')
        raise


def sync_secrets_for_repo(repo, secrets):
    print(f'\n正在同步仓库: {repo["name"]} ({"私有" if repo["private"] else "公开"})')
    
    for secret in secrets:
        try:
            set_repo_secret(repo['owner']['login'], repo['name'], secret['name'], secret['value'])
        except Exception as e:
            print(f'  同步secret {secret["name"]} 到仓库 {repo["name"]} 失败: {str(e)}')
            # 继续处理其他secrets


def test_single_repo(repo_name, secret_name, secret_value):
    print(f'\n=== 测试仓库: {repo_name} ===')
    
    try:
        # 1. 测试获取公钥
        print('1. 测试获取公钥...')
        pub_key_url = f'{API_BASE}/repos/{GITHUB_USER}/{repo_name}/actions/secrets/public-key'
        response = requests.get(pub_key_url, headers=headers)
        response.raise_for_status()
        public_key = response.json()
        print(f'✅ 公钥获取成功, key_id: {public_key["key_id"]}')
        
        # 2. 测试加密
        print('2. 测试加密...')
        public_key_obj = PublicKey(public_key['key'].encode('utf-8'))
        sealed_box = SealedBox(public_key_obj)
        encrypted = sealed_box.encrypt(secret_value.encode('utf-8'))
        encrypted_value = base64.b64encode(encrypted).decode('utf-8')
        print(f'✅ 加密成功, 加密后长度: {len(encrypted_value)}')
        
        # 3. 测试设置secret
        print('3. 测试设置secret...')
        secret_url = f'{API_BASE}/repos/{GITHUB_USER}/{repo_name}/actions/secrets/{secret_name}'
        payload = {
            'encrypted_value': encrypted_value,
            'key_id': public_key['key_id']
        }
        
        response = requests.put(secret_url, headers=headers, json=payload)
        response.raise_for_status()
        print(f'✅ 成功设置secret: {secret_name}')
        
    except Exception as e:
        print(f'❌ 测试失败: {str(e)}')


def main():
    print('GitHub Secrets 批量同步工具')
    print('==============================')
    print(f'用户: {GITHUB_USER}\n')
    
    # 检查是否是调试模式
    is_debug_mode = '--debug' in sys.argv
    debug_args = sys.argv[sys.argv.index('--debug') + 1:] if is_debug_mode else []
    
    if is_debug_mode and len(debug_args) >= 2:
        debug_repo_name = debug_args[0]
        debug_secret_name = debug_args[1]
        print(f'调试模式: 测试仓库 {debug_repo_name} 和 secret {debug_secret_name}')
        
        secrets = get_sync_secrets()
        secret_to_test = next((s for s in secrets if s['name'] == debug_secret_name), None)
        
        if not secret_to_test:
            print(f'错误: 未找到环境变量 SYNC_{debug_secret_name}')
            sys.exit(1)
            
        test_single_repo(debug_repo_name, debug_secret_name, secret_to_test['value'])
        return
    
    try:
        # 1. 获取所有仓库
        repos = get_all_user_repos()
        
        if not repos:
            print('没有找到任何非fork仓库')
            return
            
        # 2. 获取需要同步的secrets
        secrets = get_sync_secrets()
        
        if not secrets:
            print('没有找到任何SYNC_开头的环境变量')
            print('请设置形如 SYNC_API_KEY=your_value 的环境变量')
            return
            
        print('\n开始同步secrets到所有仓库...')
        
        # 3. 为每个仓库同步secrets
        success_count = 0
        error_count = 0
        
        for repo in repos:
            try:
                sync_secrets_for_repo(repo, secrets)
                success_count += 1
            except Exception as e:
                print(f'同步仓库 {repo["name"]} 失败: {str(e)}')
                error_count += 1
            
            # 添加延迟避免API限制
            time.sleep(0.1)
        
        print('\n==============================')
        print('同步完成!')
        print(f'成功: {success_count} 个仓库')
        print(f'失败: {error_count} 个仓库')
        print(f'总计: {len(repos)} 个仓库')
        print(f'同步的secrets: {len(secrets)} 个')
        
    except Exception as e:
        print(f'程序执行失败: {str(e)}')
        sys.exit(1)


if __name__ == '__main__':
    main()
