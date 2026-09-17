import { redirect } from "next/navigation";

// The backlog-first discovery review (inbox / trial / promoted / rejected) is
// retired in favour of the "New plays" history, which mirrors what the DJ
// actually played and queues typed actions for the home runtime. The legacy
// /api/music/discovery route stays for sync compatibility.
export default function MusicDiscoveryPage() {
  redirect("/music/new-plays");
}
