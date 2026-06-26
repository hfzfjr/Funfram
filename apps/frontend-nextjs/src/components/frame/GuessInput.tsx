import React from 'react';
import styles from './GuessInput.module.css';

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
    <form onSubmit={handle} className={styles.form}>
      <input
        type="text"
        placeholder="Enter guess..."
        value={value}
        onChange={e => setValue(e.target.value)}
        className={styles.input}
      />
      <button type="submit" className={styles.button}>Send</button>
    </form>
  );
}
