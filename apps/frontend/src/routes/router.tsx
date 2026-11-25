import { createBrowserRouter } from "react-router";
import PublicLayout from "@/layouts/PublicLayout";
import Home from "@/pages/public/Home";
import { AboutPage, ContactPage, DoctorDetailPage, DoctorsPage, FaqPage, LegalPage, NotFound, TreatmentDetailPage, TreatmentsPage } from "@/pages/public/Pages";
import { LoginPage, RegisterPage } from "@/pages/public/Forms";
import BookPage from "@/pages/public/Book";
import { portalRoutes } from "./portals";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "about", element: <AboutPage /> },
      { path: "doctors", element: <DoctorsPage /> },
      { path: "doctors/:slug", element: <DoctorDetailPage /> },
      { path: "treatments", element: <TreatmentsPage /> },
      { path: "treatments/:slug", element: <TreatmentDetailPage /> },
      { path: "book", element: <BookPage /> },
      { path: "contact", element: <ContactPage /> },
      { path: "faq", element: <FaqPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "privacy", element: <LegalPage kind="privacy" /> },
      { path: "terms", element: <LegalPage kind="terms" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  ...portalRoutes,
]);
