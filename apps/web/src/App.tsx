import { Navigate, Route, Routes } from "react-router-dom";

import { AiSettingsPage } from "@/pages/AiSettingsPage";
import { AppLayout } from "@/pages/AppLayout";
import { AuditPage } from "@/pages/AuditPage";
import { BidProjectsPage } from "@/pages/BidProjectsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { ChartsPage } from "@/pages/ChartsPage";
import { DepositsPage } from "@/pages/DepositsPage";
import { HomePage } from "@/pages/HomePage";
import { InquiriesPage } from "@/pages/InquiriesPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { PlatformsPage } from "@/pages/PlatformsPage";
import { UsersPage } from "@/pages/UsersPage";
import { WeeklyPage } from "@/pages/WeeklyPage";

/** 路由根 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="charts" element={<ChartsPage />} />
        <Route path="platforms" element={<PlatformsPage />} />
        <Route path="projects" element={<BidProjectsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="deposits" element={<DepositsPage />} />
        <Route path="inquiries" element={<InquiriesPage />} />
        <Route path="weekly" element={<WeeklyPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="ai-settings" element={<AiSettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
