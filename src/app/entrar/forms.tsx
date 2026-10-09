import { googleLogin, magicLink } from "./actions";

export function GoogleButton() {
  return (
    <form action={googleLogin}>
      <button className="btn-primary w-full">Entrar com Google</button>
    </form>
  );
}

export function MagicLinkForm() {
  return (
    <form action={magicLink} className="flex flex-col gap-2">
      <label htmlFor="email" className="label">E-mail</label>
      <input id="email" name="email" type="email" required autoComplete="email" className="field" />
      <button className="btn-ghost">Receber link de acesso</button>
    </form>
  );
}
