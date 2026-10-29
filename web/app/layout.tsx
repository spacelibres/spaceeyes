import type { ReactNode } from 'react';
import './style.css';
export const metadata = {title: '太空之眼 · 技术验证工作区', description: 'Bevy与受控插件SDK技术验证', icons: { icon: '/icon.svg' }};
export default function Layout({children}: {children: ReactNode}) { return <html lang="zh-CN"><body>{children}</body></html>; }
