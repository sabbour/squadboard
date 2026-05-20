import { lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout.tsx'
import RouteProgressBar from './components/RouteProgressBar.tsx'

const ProjectPicker = lazy(() => import('./pages/ProjectPicker.tsx'))
const Apps = lazy(() => import('./pages/Apps.tsx'))
const Board = lazy(() => import('./pages/Board.tsx'))
const Agents = lazy(() => import('./pages/Agents.tsx'))
const Costs = lazy(() => import('./pages/Costs.tsx'))
const Workflows = lazy(() => import('./pages/Workflows.tsx'))
const WorkflowEditor = lazy(() => import('./pages/WorkflowEditor.tsx'))
const CeremonyList = lazy(() => import('./pages/CeremonyList.tsx'))
const CeremonyEditor = lazy(() => import('./pages/CeremonyEditor.tsx'))
const CeremonyRuns = lazy(() => import('./pages/CeremonyRuns.tsx'))
const CeremoniesReview = lazy(() => import('./pages/CeremoniesReview.tsx'))
const CeremonyAudit = lazy(() => import('./pages/CeremonyAudit.tsx'))
const Settings = lazy(() => import('./pages/Settings.tsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.tsx'))
const Inbox = lazy(() => import('./pages/Inbox.tsx'))
const ProjectFlow = lazy(() => import('./pages/ProjectFlow.tsx'))
const Skills = lazy(() => import('./pages/Skills.tsx'))
const Tools = lazy(() => import('./pages/Tools.tsx'))
const McpServers = lazy(() => import('./pages/McpServers.tsx'))
const Consult = lazy(() => import('./pages/Consult.tsx'))
const Now = lazy(() => import('./pages/Now.tsx'))
const Diagnostics = lazy(() => import('./pages/Diagnostics.tsx'))
const Heartbeat = lazy(() => import('./pages/Heartbeat.tsx'))
const Templates = lazy(() => import('./pages/Templates.tsx'))
const LoadingGallery = lazy(() => import('./components/loading/LoadingGallery.tsx'))
const LiveRunViewer = lazy(() => import('./components/runs/LiveRunViewer.tsx'))

export default function App() {
  return (
    <>
      <RouteProgressBar />
      <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectPicker />} />
        {/* W26: Apps marketplace — browse and apply built-in bundle templates */}
        <Route path="apps" element={<Apps />} />
        <Route path="inbox" element={<Inbox />} />
        {/* Phase 19: global /now view — live activity across all projects */}
        <Route path="now" element={<Now />} />
        {/* Phase 17: cross-project Ask / Consult */}
        <Route path="consult" element={<Navigate to="/consult/new" replace />} />
        <Route path="consult/new" element={<Consult />} />
        <Route path="consult/:sessionId" element={<Consult />} />
        {/* Phase 3: system-level pages — diagnostics and heartbeat */}
        <Route path="diagnostics" element={<Diagnostics />} />
        <Route path="heartbeat" element={<Heartbeat />} />
        <Route path="projects/:id/diagnostics" element={<Diagnostics />} />
        <Route path="projects/:id/heartbeat" element={<Heartbeat />} />
        <Route path="projects/:id" element={<Navigate to="dashboard" replace />} />
        <Route path="projects/:id/dashboard" element={<Dashboard />} />
        <Route path="projects/:id/inbox" element={<Inbox />} />
        <Route path="projects/:id/board" element={<Board />} />
        <Route path="projects/:id/flow" element={<ProjectFlow />} />
        <Route path="projects/:id/agents" element={<Agents />} />
        <Route path="projects/:id/skills" element={<Skills />} />
        <Route path="projects/:id/tools" element={<Tools />} />
        <Route path="projects/:id/mcp-servers" element={<McpServers />} />
        {/* Phase 17: project-scoped Ask / Consult */}
        <Route path="projects/:id/consult" element={<Navigate to="new" replace />} />
        <Route path="projects/:id/consult/new" element={<Consult />} />
        <Route path="projects/:id/consult/:sessionId" element={<Consult />} />
        <Route path="projects/:id/costs" element={<Costs />} />
        {/* Phase 10: ceremonies replaces workflows. Legacy routes redirect via the page shims. */}
        <Route path="projects/:id/ceremonies" element={<CeremonyList />} />
        <Route path="projects/:id/ceremonies/review" element={<CeremoniesReview />} />
        <Route path="projects/:id/ceremonies/audit" element={<CeremonyAudit />} />
        <Route path="projects/:id/ceremonies/templates" element={<Templates />} />
        <Route path="projects/:id/ceremonies/new" element={<CeremonyEditor />} />
        <Route path="projects/:id/ceremonies/:ceremonyId/runs" element={<CeremonyRuns />} />
        <Route path="projects/:id/ceremonies/:ceremonyId" element={<CeremonyEditor />} />
        <Route path="projects/:id/workflows" element={<Workflows />} />
        <Route path="projects/:id/workflows/new" element={<WorkflowEditor />} />
        <Route path="projects/:id/workflows/:workflowId" element={<WorkflowEditor />} />
        <Route path="projects/:id/settings" element={<Settings />} />
        {/* Wave 28 JIS-T8: live run viewer */}
        <Route path="projects/:projectId/issues/:issueId/runs/:runId/live" element={<LiveRunViewer />} />
        {import.meta.env.DEV && (
          <Route path="__loading-gallery" element={<LoadingGallery />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </>
  )
}
