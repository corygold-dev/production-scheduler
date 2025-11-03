import { startServer } from "./api/server";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

startServer(port);

