
frontend/src/App.tsx

 const MetricsInputPage = lazy(() => import('./pages/MetricsInputPage'));
 const ExpertReviewPage = lazy(() => import('./pages/ExpertReviewPage'));
 const AdminFlagsPage = lazy(() => import('./pages/AdminFlagsPage'));
 const ExcelReportsPage = lazy(() => import('./pages/ExcelReportsPage'));
 
 const PageLoader = () => (
     <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>

                             <Route path="assessments/:id/input" element={<RequireRole allowedRoles={['TEST_ANALYST', 'QUALITY_MANAGER', 'ADMIN']}><MetricsInputPage /></RequireRole>} />
                             <Route path="assessments/:id/review" element={<RequireRole allowedRoles={['QUALITY_MANAGER', 'ADMIN']}><ExpertReviewPage /></RequireRole>} />
                             <Route path="admin/flags" element={<RequireRole allowedRoles={['ADMIN']}><AdminFlagsPage /></RequireRole>} />
                             <Route path="reports" element={<ExcelReportsPage />} />
                             <Route index element={<Navigate to="/dashboard" replace />} />
                         </Routes></Suspense></AppLayout></RequireAuth>} />