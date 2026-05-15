import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout.tsx'
import ProjectPicker from './pages/ProjectPicker.tsx'
import Board from './pages/Board.tsx'
import Agents from './pages/Agents.tsx'
import Costs from './pages/Costs.tsx'
import Workflows from './pages/Workflows.tsx'
import WorkflowEditor from './pages/WorkflowEditor.tsx'
import CeremonyList from './pages/CeremonyList.tsx'
import CeremonyEditor from './pages/CeremonyEditor.tsx'
import CeremoniesReview from './pages/CeremoniesReview.tsx'
import Settings from './pages/Settings.tsx'
import Dashboard from './pages/Dashboard.tsx'
import Inbox from './pages/Inbox.tsx'
import ProjectFlow from './pages/ProjectFlow.tsx'
import Skills from './pages/Skills.tsx'
import Tools from './pages/Tools.tsx'
import McpServers from './pages/McpServers.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectPicker />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="projects/:id" element={<Navigate to="dashboard" replace />} />
        <Route path="projects/:id/dashboard" element={<Dashboard />} />
        <Route path="projects/:id/inbox" element={<Inbox />} />
        <Route path="projects/:id/board" element={<Board />} />
        <Route path="projects/:id/flow" element={<ProjectFlow />} />
        <Route path="projects/:id/agents" element={<Agents />} />
        <Route path="projects/:id/skills" element={<Skills />} />
        <Route path="projects/:id/tools" element={<Tools />} />
        <Route path="projects/:id/mcp-servers" element={<McpServers />} />
        <Route path="projects/:id/costs" element={<Costs />} />
        {/* Phase 10: ceremonies replaces workflows. Legacy routes redirect via the page shims. */}
        <Route path="projects/:id/ceremonies" element={<CeremonyList />} />
        <Route path="projects/:id/ceremonies/review" element={<CeremoniesReview />} />
        <Route path="projects/:id/ceremonies/new" element={<CeremonyEditor />} />
        <Route path="projects/:id/ceremonies/:ceremonyId" element={<CeremonyEditor />} />
        <Route path="projects/:id/workflows" element={<Workflows />} />
        <Route path="projects/:id/workflows/new" element={<WorkflowEditor />} />
        <Route path="projects/:id/workflows/:workflowId" element={<WorkflowEditor />} />
        <Route path="projects/:id/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
