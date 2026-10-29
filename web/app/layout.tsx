import type { ReactNode } from "react";
import "./style.css";
export const metadata = {
  title: "太空之眼 · 太阳系工作区",
  description: "探索太阳系天体、时间与轨迹的三维仿真工作区",
  icons: { icon: "/icon.svg" },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
