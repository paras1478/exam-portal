import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GuestOnly, RequireAuth } from '@/components/layout/guards';
import { FullPageLoader } from '@/components/common';

const Landing = lazy(() => import('@/pages/public/Landing'));
const Login = lazy(() => import('@/pages/public/Login'));
const Register = lazy(() => import('@/pages/public/Register'));
const NotFound = lazy(() => import('@/pages/public/NotFound'));
const RouteError = lazy(() => import('@/pages/public/RouteError'));

const StudentDashboard = lazy(() => import('@/pages/student/StudentDashboard'));
const StudentExams = lazy(() => import('@/pages/student/StudentExams'));
const StudentExamDetail = lazy(() => import('@/pages/student/StudentExamDetail'));
const StudentResults = lazy(() => import('@/pages/student/StudentResults'));
const StudentResultDetail = lazy(() => import('@/pages/student/StudentResultDetail'));
const AttemptPage = lazy(() => import('@/pages/exam/AttemptPage'));
const SubmissionReceipt = lazy(() => import('@/pages/exam/SubmissionReceipt'));

const FacultyDashboard = lazy(() => import('@/pages/faculty/FacultyDashboard'));
const FacultyExams = lazy(() => import('@/pages/faculty/FacultyExams'));
const ExamEditor = lazy(() => import('@/pages/faculty/ExamEditor'));
const ExamSubmissions = lazy(() => import('@/pages/faculty/ExamSubmissions'));
const AttemptReview = lazy(() => import('@/pages/faculty/AttemptReview'));

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminExams = lazy(() => import('@/pages/admin/AdminExams'));
const AdminResults = lazy(() => import('@/pages/admin/AdminResults'));
const AuditLogs = lazy(() => import('@/pages/admin/AuditLogs'));
const AdminExamReview = lazy(() => import('@/pages/admin/AdminExamReview'));
const AdminResultDetail = lazy(() => import('@/pages/admin/AdminResultDetail'));
const AdminReports = lazy(() => import('@/pages/admin/AdminReports'));
const AdminSettings = lazy(() => import('@/pages/admin/AdminSettings'));
const AdminAnnouncements = lazy(() => import('@/pages/admin/AdminAnnouncements'));

const Profile = lazy(() => import('@/pages/shared/Profile'));
const Notifications = lazy(() => import('@/pages/shared/Notifications'));
const Announcements = lazy(() => import('@/pages/shared/Announcements'));

const s = (el: ReactNode) => <Suspense fallback={<FullPageLoader />}>{el}</Suspense>;

function ErrorBoundaryRoute() {
  const error = useRouteError();
  return s(<RouteError error={error} />);
}

const router = createBrowserRouter([
  {
    errorElement: <ErrorBoundaryRoute />,
    children: [
      { path: '/', element: s(<Landing />) },
      { path: '/login', element: s(<GuestOnly><Login /></GuestOnly>) },
      { path: '/register', element: s(<GuestOnly><Register /></GuestOnly>) },

      // Distraction-free exam interface (no app shell).
      {
        element: <RequireAuth roles={['STUDENT']} />,
        children: [
          { path: '/attempt/:attemptId', element: s(<AttemptPage />) },
          { path: '/attempt/:attemptId/receipt', element: s(<SubmissionReceipt />) },
        ],
      },

      {
        element: <RequireAuth><AppShell /></RequireAuth>,
        children: [
          {
            element: <RequireAuth roles={['STUDENT']} />,
            children: [
              { path: '/student', element: s(<StudentDashboard />) },
              { path: '/student/exams', element: s(<StudentExams />) },
              { path: '/student/exams/:examId', element: s(<StudentExamDetail />) },
              { path: '/student/results', element: s(<StudentResults />) },
              { path: '/student/results/:attemptId', element: s(<StudentResultDetail />) },
            ],
          },
          {
            element: <RequireAuth roles={['FACULTY', 'ADMIN']} />,
            children: [
              { path: '/faculty', element: s(<FacultyDashboard />) },
              { path: '/faculty/exams', element: s(<FacultyExams />) },
              { path: '/faculty/exams/new', element: s(<ExamEditor />) },
              { path: '/faculty/exams/:examId', element: s(<ExamEditor />) },
              { path: '/faculty/exams/:examId/submissions', element: s(<ExamSubmissions />) },
              { path: '/faculty/attempts/:attemptId', element: s(<AttemptReview />) },
              { path: '/announcements', element: s(<Announcements />) },
            ],
          },
          {
            element: <RequireAuth roles={['ADMIN']} />,
            children: [
              { path: '/admin', element: s(<AdminDashboard />) },
              { path: '/admin/users', element: s(<AdminUsers />) },
              { path: '/admin/exams', element: s(<AdminExams />) },
              { path: '/admin/exams/:examId', element: s(<AdminExamReview />) },
              { path: '/admin/results', element: s(<AdminResults />) },
              { path: '/admin/results/:resultId', element: s(<AdminResultDetail />) },
              { path: '/admin/reports', element: s(<AdminReports />) },
              { path: '/admin/announcements', element: s(<AdminAnnouncements />) },
              { path: '/admin/audit-logs', element: s(<AuditLogs />) },
              { path: '/admin/settings', element: s(<AdminSettings />) },
            ],
          },
          { path: '/profile', element: s(<Profile />) },
          { path: '/notifications', element: s(<Notifications />) },
        ],
      },
      { path: '*', element: s(<NotFound />) },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
