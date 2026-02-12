import { redirect } from "next/navigation";

export default function Home() {
  // Root path is not used in production (basePath deploys under /chess_db),
  // but keep a sensible redirect for local/dev and accidental navigation.
  redirect("/games");
}

