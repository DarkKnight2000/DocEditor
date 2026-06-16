import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [tailwindcss(), sveltekit()] });
// export default defineConfig(({command}) => {
    
//     let server_address = '/api'
//     if(command === 'serve')
//     {
//         // if running npm run dev locally, this redirects to backend locally
//         // if running any other command, probably build command, it should be redirected by /api
//         server_address = 'localhost:8000/api';
//     }
//     console.log('server addr', server_address);

//     return {
//         plugins: [tailwindcss(), sveltekit()],
//         server: {
//             proxy: {
//                 '/api': server_address
//             }
//         },
//         define: {
//             SERVER_ADDRESS: JSON.stringify(server_address)
//         }
//     };
// });
