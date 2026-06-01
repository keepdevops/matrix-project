import { useState, useRef, useEffect } from 'react';
import { startConversion, pollConversion } from '../api/swarmApi';
import { guessHfRepo, guessOutputName } from './modelConverterGuess';

export function useModelConverterRow({ model, onDone }) {
  const [open,       setOpen]       = useState(false);
  const [hfRepo,     setHfRepo]     = useState(() => guessHfRepo(model.name));
  const [outputName, setOutputName] = useState(() => guessOutputName(model.name));
  const [qBits,      setQBits]      = useState(4);
  const [hfToken,    setHfToken]    = useState('');
  const [job,        setJob]        = useState(null);
  const [error,      setError]      = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  const start = async () => {
    setError(null);
    try {
      const { job_id } = await startConversion({
        hf_repo: hfRepo, output_name: outputName, q_bits: qBits, hf_token: hfToken,
      });
      setJob({ job_id, status: 'running', step: 'starting', pct: 0 });
      pollRef.current = setInterval(async () => {
        try {
          const j = await pollConversion(job_id);
          setJob(j);
          if (j.status === 'done')  { stopPolling(); if (onDone) onDone(); }
          if (j.status === 'error') { stopPolling(); setError(j.error || 'Conversion failed'); }
        } catch (e) { setError(e.message); stopPolling(); }
      }, 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  const busy = job && job.status === 'running';
  const done = job && job.status === 'done';

  return {
    open, setOpen, hfRepo, setHfRepo, outputName, setOutputName,
    qBits, setQBits, hfToken, setHfToken, job, error, busy, done, start,
  };
}
