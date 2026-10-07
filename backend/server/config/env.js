const path = require('path');
const dotenv = require('dotenv');

/**
 * Single source of truth for environment loading - required by server.js and every
 * server/scripts/*.js script, so there is exactly one resolved configuration, not two competing
 * ones. Loads config.env first (the documented convention - see backend/.env.example), then a
 * plain .env if present, with override so .env wins when both define the same variable. This
 * lets local/IDE tooling use a conventional .env file without breaking the documented config.env
 * convention that other scripts/deployment docs already reference.
 */
function loadEnv() {
  dotenv.config({ path: path.join(__dirname, '../../config.env') });
  dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
}

module.exports = { loadEnv };
