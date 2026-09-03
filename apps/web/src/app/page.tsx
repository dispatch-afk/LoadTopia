import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";

export default async function IndexPage() {
  const me = await getMe();
  redirect(me ? "/dashboard" : "/login");
}
