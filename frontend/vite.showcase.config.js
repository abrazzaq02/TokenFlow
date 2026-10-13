import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
export default defineConfig({plugins:[react()],define:{'import.meta.env.VITE_APP_MODE':JSON.stringify('showcase')},css:{postcss:{plugins:[tailwindcss()]}},build:{outDir:'../dist-showcase',emptyOutDir:true}});
