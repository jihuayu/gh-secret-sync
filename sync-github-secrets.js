// sync-github-secrets.js
// 读取环境变量中所有以SYNC_开头的变量，将其同步到指定GitHub用户下所有非fork仓库的Actions Secrets
// 需要设置GITHUB_TOKEN环境变量用于API认证

const fetch = require('node-fetch');
const process = require('process');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = process.env.GITHUB_USER;
if (!GITHUB_TOKEN || !GITHUB_USER) {
    console.error('请设置GITHUB_TOKEN和GITHUB_USER环境变量');
    process.exit(1);
}

const API_BASE = 'https://api.github.com';

async function getAllRepos(user) {
    let repos = [];
    let page = 1;
    while (true) {
        const res = await fetch(`${API_BASE}/users/${user}/repos?per_page=100&page=${page}`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        if (!res.ok) throw new Error('获取仓库失败: ' + res.statusText);
        const data = await res.json();
        if (data.length === 0) break;
        repos = repos.concat(data.filter(r => !r.fork));
        page++;
    }
    return repos;
}

function getSyncSecrets() {
    return Object.entries(process.env)
        .filter(([k]) => k.startsWith('SYNC_'))
        .map(([k, v]) => ({ name: k.replace(/^SYNC_/, ''), value: v }));
}

async function setRepoSecret(owner, repo, secretName, secretValue) {
    // 需要先获取公钥
    const pubRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/actions/secrets/public-key`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    if (!pubRes.ok) throw new Error(`获取${repo}公钥失败: ` + pubRes.statusText);
    const pub = await pubRes.json();
    // 加密secret
    const sodium = require('tweetsodium');
    const key = Buffer.from(pub.key, 'base64');
    const valueBytes = Buffer.from(secretValue);
    const encryptedBytes = sodium.seal(valueBytes, key);
    const encrypted = Buffer.from(encryptedBytes).toString('base64');
    // 上传secret
    const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            encrypted_value: encrypted,
            key_id: pub.key_id
        })
    });
    if (!res.ok) throw new Error(`设置${repo}的secret ${secretName} 失败: ` + res.statusText);
}

async function main() {
    const repos = await getAllRepos(GITHUB_USER);
    const secrets = getSyncSecrets();
    for (const repo of repos) {
        for (const secret of secrets) {
            console.log(`同步 ${repo.name} 的 secret: ${secret.name}`);
            await setRepoSecret(GITHUB_USER, repo.name, secret.name, secret.value);
        }
    }
    console.log('同步完成');
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
