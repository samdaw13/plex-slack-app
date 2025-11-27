const dotenv = require('dotenv');
const { exec } = require('child_process');

dotenv.config();

const ngrokToken = process.env.NGROK_TOKEN;

if (!ngrokToken) {
  console.error('❌ NGROK_TOKEN not found in .env file');
  process.exit(1);
}

console.log('🔐 Authenticating ngrok...');

exec(`npx ngrok config add-authtoken ${ngrokToken}`, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  }
  if (stderr) {
    console.error('⚠️  Warning:', stderr);
  }
  console.log('✅ ngrok authenticated successfully!');
  console.log(stdout);
});
