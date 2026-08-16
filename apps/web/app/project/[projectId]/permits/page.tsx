import { PermitsChecklistStep } from "../../../../components/permits/PermitsChecklistStep";

export default async function PermitsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <div className="h-screen w-screen">
      <PermitsChecklistStep projectId={projectId} />
    </div>
  );
}
