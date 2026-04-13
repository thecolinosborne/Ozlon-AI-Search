import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { VideoStudioDashboard } from '@/components/studio/VideoStudioDashboard';

const Studio = () => {
  const navigate = useNavigate();
  const { authLoading, session } = useAuth();

  useEffect(() => {
    if (!authLoading && !session) navigate('/auth');
  }, [authLoading, session, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border/30 px-4 py-3">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-lg font-semibold text-foreground">Video Studio</h1>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-4">
        <VideoStudioDashboard />
      </div>
    </div>
  );
};

export default Studio;
