import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
export default defineConfig({plugins:[react()],css:{postcss:{plugins:[tailwindcss()]}},resolve:{alias:{'react-router-dom':path.resolve('src/router-showcase.jsx'),'qrcode':path.resolve('src/qr-showcase.js'),'firebase/app':path.resolve('src/firebase-showcase.js'),'firebase/auth':path.resolve('src/firebase-showcase.js'),'firebase/firestore':path.resolve('src/firebase-showcase.js')}},build:{outDir:'../dist',emptyOutDir:true}});
