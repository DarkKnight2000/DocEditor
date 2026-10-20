import { mount } from 'svelte';
import '@fontsource-variable/nunito';
import './app.css';
import App from './App.svelte';

const app = mount(App, { target: /** @type {HTMLElement} */ (document.getElementById('app')) });

export default app;
