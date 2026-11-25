import { useEffect, useState, type FormEvent } from "react";

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Channel = { code: string; label: string; sendsEmail: boolean; sendsSms: boolean };
type TicklerOption = { code: string; label: string; repeats: boolean; defaultDays: number | null };
type Options = { channels: Channel[]; ticklerOptions: TicklerOption[]; defaults: { quietStart: string; quietEnd: string; timezone: string; ticklerTime: string; minIntervalDays: number; maxIntervalDays: number } };
type Preference = { channel: string; email: string | null; phone: string | null; quietStart: string | null; quietEnd: string | null; timezone: string | null; optedOut: boolean; consentAt: string | null };
type Tickler = { optionCode: string; intervalDays: number | null; weekday: number | null; timeOfDay: string; nextAt: string | null; stoppedAt: string | null; stopReason: string | null; sentCount: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** How Unwhelm reminds the client, and an optional tickler to finish this proposal. Choices come from DB rows. */
export function RemindersPanel({ proposalId, api, unfinished }: { proposalId: string; api: Api; unfinished: boolean }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [pref, setPref] = useState<Preference | null>(null);
  const [tickler, setTickler] = useState<Tickler | null>(null);
  const [form, setForm] = useState({ channel: "email", email: "", phone: "", quietStart: "", quietEnd: "", timezone: "", consent: false });
  const [schedule, setSchedule] = useState({ option: "tomorrow_at", intervalDays: 3, weekday: 1, timeOfDay: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Options>("/api/v1/reminders/options"),
      api<{ preference: Preference | null }>("/api/v1/me/contact-preference"),
      api<{ tickler: Tickler | null }>(`/api/v1/proposals/${proposalId}/tickler`),
    ]).then(([loaded, preference, current]) => {
      if (cancelled) return;
      setOptions(loaded);
      setPref(preference.preference);
      setTickler(current.tickler);
      const p = preference.preference;
      setForm({ channel: p?.channel ?? "email", email: p?.email ?? "", phone: p?.phone ?? "", quietStart: p?.quietStart ?? loaded.defaults.quietStart, quietEnd: p?.quietEnd ?? loaded.defaults.quietEnd, timezone: p?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || loaded.defaults.timezone), consent: Boolean(p?.consentAt) });
      setSchedule((value) => ({ ...value, timeOfDay: current.tickler?.timeOfDay ?? loaded.defaults.ticklerTime, option: current.tickler?.optionCode ?? value.option, intervalDays: current.tickler?.intervalDays ?? value.intervalDays, weekday: current.tickler?.weekday ?? value.weekday }));
    }).catch(() => { if (!cancelled) setOptions(null); });
    return () => { cancelled = true; };
  }, [proposalId]);

  if (!options) return null;
  const channel = options.channels.find((item) => item.code === form.channel);
  const option = options.ticklerOptions.find((item) => item.code === schedule.option);

  async function savePreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const saved = await api<{ preference: Preference }>("/api/v1/me/contact-preference", { method: "PUT", body: JSON.stringify({ channel: form.channel, email: form.email || null, phone: form.phone || null, quietStart: form.quietStart || null, quietEnd: form.quietEnd || null, timezone: form.timezone || null, consent: form.consent, optOut: false }) });
      setPref(saved.preference);
      setMessage("Reminder settings saved.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not save reminder settings."); }
  }
  async function saveTickler(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const body = { option: schedule.option, timeOfDay: schedule.timeOfDay, ...(schedule.option === "weekly" ? { weekday: schedule.weekday } : {}), ...(schedule.option === "snooze" || schedule.option === "every_n_days" ? { intervalDays: schedule.intervalDays } : {}) };
      setTickler((await api<{ tickler: Tickler }>(`/api/v1/proposals/${proposalId}/tickler`, { method: "PUT", body: JSON.stringify(body) })).tickler);
      setMessage("We'll remind you.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not schedule that reminder."); }
  }
  async function stopTickler() {
    try { await api(`/api/v1/proposals/${proposalId}/tickler`, { method: "DELETE" }); setTickler((value) => value ? { ...value, stoppedAt: new Date().toISOString(), stopReason: "client_stopped", nextAt: null } : value); setMessage("Reminders for this proposal are off."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not stop reminders."); }
  }
  const active = tickler && !tickler.stoppedAt;
  const canTickle = Boolean(pref && pref.channel !== "none" && !pref.optedOut);

  return <section className="portal-reminders" aria-label="Reminders">
    <h3>Reminders</h3>
    <form className="portal-form" onSubmit={savePreference}>
      <label>How should we remind you?<select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>{options.channels.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      {channel?.sendsEmail && <label>Email <span className="portal-help">Blank uses your account email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>}
      {channel?.sendsSms && <label>Mobile number <span className="portal-help">e.g. +15551234567</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></label>}
      {(channel?.sendsEmail || channel?.sendsSms) && <>
        <div className="portal-form-row"><label>Quiet from<input type="time" value={form.quietStart} onChange={(event) => setForm({ ...form, quietStart: event.target.value })} /></label><label>until<input type="time" value={form.quietEnd} onChange={(event) => setForm({ ...form, quietEnd: event.target.value })} /></label></div>
        <label>Timezone<input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
        <label className="portal-checkbox"><input type="checkbox" checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} /> I agree to receive reminders about my proposals. Reply STOP to texts or use the unsubscribe link to stop.</label>
      </>}
      {pref?.optedOut && <p className="portal-muted">You've unsubscribed. Saving turns reminders back on.</p>}
      <div className="portal-actions"><button type="submit">Save reminder settings</button></div>
    </form>
    {unfinished && <form className="portal-form" onSubmit={saveTickler}>
      <h4>Finish later</h4>
      {active && <p>Next reminder {tickler.nextAt ? new Date(tickler.nextAt).toLocaleString() : "soon"}. <button type="button" onClick={() => void stopTickler()}>Stop</button></p>}
      {!canTickle && <p className="portal-muted">Pick email or text above to get a nudge to finish.</p>}
      <label>Remind me<select value={schedule.option} onChange={(event) => setSchedule({ ...schedule, option: event.target.value, intervalDays: options.ticklerOptions.find((item) => item.code === event.target.value)?.defaultDays ?? schedule.intervalDays })}>{options.ticklerOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      {(option?.code === "snooze" || option?.code === "every_n_days") && <label>Days<input type="number" min={options.defaults.minIntervalDays} max={options.defaults.maxIntervalDays} value={schedule.intervalDays} onChange={(event) => setSchedule({ ...schedule, intervalDays: Number(event.target.value) })} /></label>}
      {option?.code === "weekly" && <label>Day<select value={schedule.weekday} onChange={(event) => setSchedule({ ...schedule, weekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
      <label>At<input type="time" value={schedule.timeOfDay} onChange={(event) => setSchedule({ ...schedule, timeOfDay: event.target.value })} /></label>
      <div className="portal-actions"><button type="submit" disabled={!canTickle}>{active ? "Change reminder" : "Set reminder"}</button></div>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
