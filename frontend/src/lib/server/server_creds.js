// place files you want to import through the `$lib` alias in this folder.

import { dev } from "$app/environment"

let SERVER_ADDRESS = "backend:8000/api";

if(dev)
{
    SERVER_ADDRESS = "localhost:8000/api";
}

export const HTTP_SERVER_ADDRESS = `http://${SERVER_ADDRESS}`
// export const WS_SERVER_ADDRESS = `ws://${SERVER_ADDRESS}`