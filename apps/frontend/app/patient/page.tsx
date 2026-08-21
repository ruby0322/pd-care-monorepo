import PatientHome from "@/app/patient/patient-home";
import { getLatestPublishedPost } from "@/lib/blog/posts";

export default function PatientPage() {
  const latestNewsPost = getLatestPublishedPost();
  return <PatientHome latestNewsPost={latestNewsPost} />;
}
