// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "SPACEEYES · 浏览器场景",
  description: "共享 Rust 核心的浏览器三维场景技术原型",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
