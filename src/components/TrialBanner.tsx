import { useState } from 'react';
import { Clock, ExternalLink, AlertTriangle } from 'lucide-react';
import { useTrialState } from '@/lib/trial';
import { UpgradeModal } from '@/components/UpgradeModal';

export function TrialBanner() {
  const trial = useTrialState();
  const [showModal, setShowModal] = useState(false);

  if (!trial) return null;

  if (trial.isExpired) {
    return (
      <>
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border-b border-red-200 text-xs shrink-0">
          <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />
          <span className="font-semibold text-red-800">Trial expired — compile and AI are disabled.</span>
          <div className="flex-1" />
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded-full transition-colors whitespace-nowrap"
          >
            Upgrade for €299 <ExternalLink size={10} />
          </button>
        </div>
        {showModal && <UpgradeModal feature="generic" onClose={() => setShowModal(false)} />}
      </>
    );
  }

  const timeLeft = trial.daysRemaining > 0
    ? `${trial.daysRemaining} day${trial.daysRemaining !== 1 ? 's' : ''} left`
    : `${trial.hoursRemaining}h left`;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs shrink-0">
        <Clock size={12} className="text-amber-500 flex-shrink-0" />
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 hover:underline text-amber-800 font-medium"
        >
          Trial · {timeLeft} · {trial.scenesUsed}/{trial.limits.maxScenes} scenes · {trial.languagesUsed}/{trial.limits.maxLanguages} languages
        </button>
        <span className="text-amber-600/60">·</span>
        <span className="text-amber-700">{trial.aiCallsRemaining}/{trial.limits.maxAiCalls} AI calls remaining</span>
        <div className="flex-1" />
        <button
          onClick={() => window.conchitour.openUrl('https://conchitour.com/buy')}
          className="flex items-center gap-1 font-semibold text-amber-800 bg-amber-200 hover:bg-amber-300 px-3 py-1 rounded-full transition-colors whitespace-nowrap"
        >
          Upgrade for €299 <ExternalLink size={10} />
        </button>
      </div>
      {showModal && <UpgradeModal feature="generic" onClose={() => setShowModal(false)} />}
    </>
  );
}
