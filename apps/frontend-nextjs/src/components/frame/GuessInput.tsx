import React from 'react';

interface Props {
  onSubmit: (guess: string) => void;
}

export default function GuessInput({ onSubmit }: Props) {
  const [value, setValue] = React.useState('');
  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  };
  return (
    <form onSubmit={handle} className="w-full">
      <input
        type="text"
        placeholder="Enter guess..."
        value={value}
        onChange={e => setValue(e.target.value)}
        className="w-full px-4 py-3 rounded-lg bg-white border border-slate-300 focus:border-indigo-600 text-slate-900 text-base outline-none transition-colors"
      />
      <button
        type="submit"
        className="mt-2 w-full p-3 bg-indigo-600 hover:bg-indigo-700 text-white border-none rounded-lg font-bold cursor-pointer transition-colors"
      >
        Send
      </button>
    </form>
  );
}
