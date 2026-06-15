import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard";

export const metadata: Metadata = { title: "Plan — NodeVelo" };

export default function PlanPage() {
  return <Dashboard mode="plan" />;
}
