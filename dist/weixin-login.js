/**
 * WeChat iLink Bot QR Login — obtain a bearer token for the WeChat adapter.
 *
 * Called from CLI: `golembot weixin-login`
 */
export async function runWeixinLogin(baseUrl) {
    const BASE_URL = (baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/$/, '');
    // Step 1: Get QR code
    console.log('Fetching QR code from iLink Bot...\n');
    const qrResp = await fetch(`${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`);
    if (!qrResp.ok) {
        console.error(`Failed to get QR code: HTTP ${qrResp.status}`);
        process.exit(1);
    }
    const qrData = (await qrResp.json());
    const qrcodeToken = qrData.qrcode;
    const qrcodeUrl = qrData.qrcode_img_content;
    if (!qrcodeToken) {
        console.error('No qrcode token in response:', JSON.stringify(qrData));
        process.exit(1);
    }
    // Step 2: Display QR code in terminal
    if (qrcodeUrl) {
        try {
            const { createRequire } = await import('node:module');
            const require = createRequire(import.meta.url);
            const qrTerminal = require('qrcode-terminal');
            qrTerminal.generate(qrcodeUrl, { small: true });
        }
        catch {
            // qrcode-terminal not available — show URL only
        }
        console.log(`\nScan the QR code above with WeChat, or open this URL in your browser:\n  ${qrcodeUrl}\n`);
    }
    console.log('Waiting for WeChat scan...\n');
    // Step 3: Poll for confirmation
    const POLL_INTERVAL = 3000;
    const TIMEOUT = 5 * 60 * 1000;
    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 35_000);
        try {
            const statusResp = await fetch(`${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${qrcodeToken}`, {
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!statusResp.ok) {
                console.error(`Status check failed: HTTP ${statusResp.status}`);
                await sleep(POLL_INTERVAL);
                continue;
            }
            const statusData = (await statusResp.json());
            switch (statusData.status) {
                case 'wait':
                    process.stdout.write('.');
                    break;
                case 'scaned':
                    console.log('\nQR code scanned! Confirm on your phone...');
                    break;
                case 'expired':
                    console.error('\nQR code expired. Please run again.');
                    process.exit(1);
                    break;
                case 'confirmed': {
                    console.log('\n\nLogin successful!\n');
                    console.log('─'.repeat(60));
                    console.log(`Token:    ${statusData.bot_token}`);
                    if (statusData.baseurl)
                        console.log(`Base URL: ${statusData.baseurl}`);
                    if (statusData.ilink_bot_id)
                        console.log(`Bot ID:   ${statusData.ilink_bot_id}`);
                    if (statusData.ilink_user_id)
                        console.log(`User ID:  ${statusData.ilink_user_id}`);
                    console.log('─'.repeat(60));
                    console.log('\nAdd to golem.yaml:\n');
                    console.log('  channels:');
                    console.log('    weixin:');
                    console.log(`      token: "${statusData.bot_token}"`);
                    if (statusData.baseurl && statusData.baseurl !== BASE_URL) {
                        console.log(`      baseUrl: "${statusData.baseurl}"`);
                    }
                    console.log('\nOr set environment variable:\n');
                    console.log(`  export WEIXIN_BOT_TOKEN="${statusData.bot_token}"`);
                    console.log('');
                    return;
                }
                default:
                    console.log(`Unknown status: ${statusData.status}`);
            }
        }
        catch (e) {
            clearTimeout(timer);
            if (e.name === 'AbortError') {
                // Timeout on long-poll, just retry
            }
            else {
                console.error(`Poll error: ${e.message}`);
            }
        }
        await sleep(POLL_INTERVAL);
    }
    console.error('\nLogin timed out (5 minutes). Please try again.');
    process.exit(1);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=weixin-login.js.map