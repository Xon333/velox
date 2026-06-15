import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard";

export const metadata: Metadata = { title: "Today — NodeVelo" };

export default function TodayPage() {
  return <Dashboard mode="today" />;
}
