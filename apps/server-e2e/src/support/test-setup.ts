/* eslint-disable */
import axios from 'axios';
import { config } from 'dotenv';
import { join } from 'path';

module.exports = async function () {
  // Same env the server itself runs with (PORT, DATABASE_URL, REDIS_URL) so
  // specs can hit the right port and verify state in Postgres/Redis.
  config({ path: join(__dirname, '../../../server/.env') });

  // Configure axios for tests to use.
  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ?? '3000';
  axios.defaults.baseURL = `http://${host}:${port}`;
};
