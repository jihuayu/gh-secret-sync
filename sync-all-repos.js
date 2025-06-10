import fetch from 'node-fetch';
import process from 'process';
import _sodium from 'libsodium-wrappers';

// 从环境变量获取GitHub配置
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = process.env.GITHUB_USER;

if (!GITHUB_TOKEN || !GITHUB_USER) {
    console.error('错误: 请设置GITHUB_TOKEN和GITHUB_USER环境变量');
    console.error('GITHUB_TOKEN: GitHub Personal Access Token (需要repo权限)');
    console.error('GITHUB_USER: GitHub用户名');
    process.exit(1);
}

const API_BASE = 'https://api.github.com';

/**
 * 获取用户所有非fork仓库（包括私有仓库）
 */
async function getAllUserRepos() {
    console.log('正在获取所有仓库...');
    let repos = [];
    let page = 1;
    
    while (true) {
        try {
            const res = await fetch(`${API_BASE}/user/repos?per_page=100&page=${page}&type=all`, {
                headers: { 
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (!res.ok) {
                throw new Error(`获取仓库失败: ${res.status} ${res.statusText}`);
            }
            
            const data = await res.json();
            if (data.length === 0) break;
            
            // 过滤掉fork的仓库，只保留用户自己的仓库
            const ownRepos = data.filter(repo => 
                !repo.fork && 
                repo.owner.login === GITHUB_USER
            );
            
            repos = repos.concat(ownRepos);
            page++;
            
            console.log(`已获取第 ${page - 1} 页，找到 ${ownRepos.length} 个非fork仓库`);
            
        } catch (error) {
            console.error(`获取第 ${page} 页仓库时出错:`, error.message);
            throw error;
        }
    }
    
    console.log(`总共找到 ${repos.length} 个非fork仓库`);
    return repos;
}

/**
 * 获取所有以SYNC_开头的环境变量作为secrets
 */
function getSyncSecrets() {
    const syncSecrets = Object.entries(process.env)
        .filter(([key]) => key.startsWith('SYNC_'))
        .map(([key, value]) => ({
            name: key.replace(/^SYNC_/, ''),
            value: value
        }));
    
    console.log(`找到 ${syncSecrets.length} 个SYNC_开头的环境变量:`);
    syncSecrets.forEach(secret => {
        console.log(`  - ${secret.name}: ${secret.value.substring(0, 10)}...`);
    });
    
    return syncSecrets;
}

/**
 * 为指定仓库设置secret
 */
async function setRepoSecret(owner, repoName, secretName, secretValue) {
    try {
        // 确保sodium已初始化
        await _sodium.ready;
        const sodium = _sodium;
        
        // 1. 获取仓库的公钥
        const pubKeyRes = await fetch(`${API_BASE}/repos/${owner}/${repoName}/actions/secrets/public-key`, {
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!pubKeyRes.ok) {
            throw new Error(`获取公钥失败: ${pubKeyRes.status} ${pubKeyRes.statusText}`);
        }
        
        const publicKey = await pubKeyRes.json();
        
        // 2. 使用公钥加密secret值
        const key = sodium.from_base64(publicKey.key);
        const valueBytes = sodium.from_string(secretValue);
        const encryptedBytes = sodium.crypto_box_seal(valueBytes, key);
        const encryptedValue = sodium.to_base64(encryptedBytes);
        
        // 3. 设置或更新secret
        const secretRes = await fetch(`${API_BASE}/repos/${owner}/${repoName}/actions/secrets/${secretName}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                encrypted_value: encryptedValue,
                key_id: publicKey.key_id
            })
        });
        
        if (!secretRes.ok) {
            throw new Error(`设置secret失败: ${secretRes.status} ${secretRes.statusText}`);
        }
        
        console.log(`  ✓ 成功设置 ${secretName}`);
        
    } catch (error) {
        console.error(`  ✗ 设置 ${secretName} 失败:`, error.message);
        throw error;
    }
}

/**
 * 为单个仓库同步所有secrets
 */
async function syncSecretsForRepo(repo, secrets) {
    console.log(`\n正在同步仓库: ${repo.name} (${repo.private ? '私有' : '公开'})`);
    
    for (const secret of secrets) {
        try {
            await setRepoSecret(repo.owner.login, repo.name, secret.name, secret.value);
        } catch (error) {
            console.error(`  同步secret ${secret.name} 到仓库 ${repo.name} 失败:`, error.message);
            // 继续处理其他secrets，不因为一个失败而中断
        }
    }
}

/**
 * 主函数
 */
async function main() {
    console.log('GitHub Secrets 批量同步工具');
    console.log('==============================');
    console.log(`用户: ${GITHUB_USER}`);
    console.log('');
    
    try {
        // 1. 获取所有仓库
        const repos = await getAllUserRepos();
        
        if (repos.length === 0) {
            console.log('没有找到任何非fork仓库');
            return;
        }
        
        // 2. 获取需要同步的secrets
        const secrets = getSyncSecrets();
        
        if (secrets.length === 0) {
            console.log('没有找到任何SYNC_开头的环境变量');
            console.log('请设置形如 SYNC_API_KEY=your_value 的环境变量');
            return;
        }
        
        console.log('\n开始同步secrets到所有仓库...');
        
        // 3. 为每个仓库同步secrets
        let successCount = 0;
        let errorCount = 0;
        
        for (const repo of repos) {
            try {
                await syncSecretsForRepo(repo, secrets);
                successCount++;
            } catch (error) {
                console.error(`同步仓库 ${repo.name} 失败:`, error.message);
                errorCount++;
            }
            
            // 添加小延迟避免API限制
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n==============================');
        console.log('同步完成!');
        console.log(`成功: ${successCount} 个仓库`);
        console.log(`失败: ${errorCount} 个仓库`);
        console.log(`总计: ${repos.length} 个仓库`);
        console.log(`同步的secrets: ${secrets.length} 个`);
        
    } catch (error) {
        console.error('程序执行失败:', error.message);
        process.exit(1);
    }
}

// 运行主函数
main().catch(error => {
    console.error('未捕获的错误:', error);
    process.exit(1);
});

export {
    getAllUserRepos,
    getSyncSecrets,
    setRepoSecret,
    syncSecretsForRepo
};
