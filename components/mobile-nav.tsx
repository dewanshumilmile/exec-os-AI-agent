"use client";

import { LayoutDashboard, Activity, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="mobile-nav">
      {navItems.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`mobile-nav-item ${pathname === href ? "active" : ""}`}
        >
          <Icon className="h-5 w-5" />
          <span className="mobile-nav-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}