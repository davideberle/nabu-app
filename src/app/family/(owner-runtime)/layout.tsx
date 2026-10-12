import { redirect,notFound } from "next/navigation";
import { ownerAccess,enabled } from "@/lib/family-runtime-test-server";
import { RuntimeTestPanel } from "@/components/family/runtime-test/panel";
export default async function Layout({children}:{children:React.ReactNode}){
 const access=await ownerAccess();if(!access.allowed)redirect(access.status===401?"/login":"/family/home");
 if(!enabled())notFound();return <RuntimeTestPanel>{children}</RuntimeTestPanel>;
}
