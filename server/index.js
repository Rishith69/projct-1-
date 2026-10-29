import 'dotenv/config';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const database = createDatabase();
const app = createApp(database);
const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`Harvest Share API listening on http://localhost:${port}`);
});
