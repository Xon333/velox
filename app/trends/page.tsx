import type { Metadata } from "next";
import Trends from "@/components/Trends";

export const metadata: Metadata = { title: "Trends — Velox" };

export default function TrendsPage() {
  return <Trends />;
}
