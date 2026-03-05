/**
 * MATRIX SWARM API 
 * Target: Node Proxy (3002) -> C++ Coordinator (8000)
 */

const API_BASE = 'http://localhost:3002/api';

/**
 * Submit a prompt to all three agents via the coordinator
 * @param {string} prompt - The user's prompt
 * @param {number} temperature - Temperature setting (0.1 - 1.0)
 * @returns {Promise<{logic: string, utility: string, architect: string}>}
 */
export async function submitPrompt(prompt, temperature = 0.7) {
  const response = await fetch(`${API_BASE}/architect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, temperature }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Fetch history of previous prompts and responses
 * @returns {Promise<Array>}
 */
export async function fetchHistory() {
  const response = await fetch(`${API_BASE}/history`);

  if (!response.ok) {
    throw new Error(`Failed to fetch history: ${response.status}`);
  }

  return response.json();
}

/**
 * Check if the coordinator is healthy/online
 * @returns {Promise<boolean>}
 */
export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/history`);
    return response.ok;
  } catch {
    return false;
  }
}
