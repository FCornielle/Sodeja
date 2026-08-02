import { ProjectFlow } from "../../../components/ProjectFlow";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <div className="h-screen w-screen">
      <ProjectFlow projectId={projectId} />
    </div>
  );
}
