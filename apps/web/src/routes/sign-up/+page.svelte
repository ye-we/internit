<script lang="ts">
	import { goto } from '$app/navigation';
	import { signUp, signIn } from '$lib/auth-client';
	import { Asterisk } from '@lucide/svelte';

	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let password = $state('');

	const handleSignUp = async () => {
		await signUp.email({
			email,
			password,
			name: `${firstName} ${lastName}`,
			callbackURL: '/',
			fetchOptions: {
				onSuccess() {
					alert('Your account has been created.');
					goto('/');
				},
				onError(context: { error: { message: string } }) {
					alert(context.error.message);
				}
			}
		});
	};

	const handleGoogle = async () => {
		await signIn.social({
			provider: 'google',
			callbackURL: '/'
		});
	};
</script>

<div
	class="flex min-h-screen flex-col items-center justify-center bg-[#f0e6d2] px-4 py-8 font-sans text-neutral-900 antialiased"
>
	<a href="/" class="mb-7 flex items-center gap-1.5">
		<Asterisk class="size-3.5 text-[#5a4226]" strokeWidth={2.5} />
		<span class="font-serif text-[20px] leading-none font-semibold tracking-tight italic">
			InternIt
		</span>
	</a>

	<div
		class="w-full max-w-sm overflow-hidden rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/40 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-sm"
	>
		<header class="border-b border-[#b8956a]/25 px-6 py-5">
			<h1 class="font-serif text-[22px] leading-tight font-semibold tracking-tight">
				Create your account
			</h1>
			<p class="mt-1 text-[13px] text-neutral-500">Start tracking internships in seconds</p>
		</header>

		<form
			class="grid gap-4 px-6 py-5"
			onsubmit={(e) => {
				e.preventDefault();
				handleSignUp();
			}}
		>
			<div class="grid grid-cols-2 gap-3">
				<div class="grid gap-1.5">
					<label
						for="first-name"
						class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600 uppercase"
					>
						First name
					</label>
					<input
						id="first-name"
						placeholder="Max"
						required
						bind:value={firstName}
						class="h-9 w-full rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/50 px-3 text-[13px] placeholder:text-neutral-500 focus:ring-2 focus:ring-[#8a6e47]/40 focus:outline-none"
					/>
				</div>
				<div class="grid gap-1.5">
					<label
						for="last-name"
						class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600 uppercase"
					>
						Last name
					</label>
					<input
						id="last-name"
						placeholder="Robinson"
						required
						bind:value={lastName}
						class="h-9 w-full rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/50 px-3 text-[13px] placeholder:text-neutral-500 focus:ring-2 focus:ring-[#8a6e47]/40 focus:outline-none"
					/>
				</div>
			</div>

			<div class="grid gap-1.5">
				<label
					for="email"
					class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600 uppercase"
				>
					Email
				</label>
				<input
					id="email"
					type="email"
					placeholder="you@example.com"
					required
					bind:value={email}
					class="h-9 w-full rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/50 px-3 text-[13px] placeholder:text-neutral-500 focus:ring-2 focus:ring-[#8a6e47]/40 focus:outline-none"
				/>
			</div>

			<div class="grid gap-1.5">
				<label
					for="password"
					class="text-[10.5px] font-semibold tracking-[0.08em] text-neutral-600 uppercase"
				>
					Password
				</label>
				<input
					id="password"
					type="password"
					required
					bind:value={password}
					class="h-9 w-full rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/50 px-3 text-[13px] focus:ring-2 focus:ring-[#8a6e47]/40 focus:outline-none"
				/>
			</div>

			<button
				type="submit"
				class="mt-1 flex h-9 items-center justify-center rounded-md bg-[#5a4226] px-4 text-[13px] font-semibold text-[#f8efde] hover:bg-[#7a5631]"
			>
				Create account
			</button>

			<div class="flex items-center gap-3 py-0.5">
				<span class="h-px flex-1 bg-[#b8956a]/40"></span>
				<span class="text-[10px] tracking-[0.1em] text-neutral-500 uppercase">or</span>
				<span class="h-px flex-1 bg-[#b8956a]/40"></span>
			</div>

			<button
				onclick={handleGoogle}
				type="button"
				class="flex h-9 items-center justify-center rounded-md border border-[#b8956a]/40 bg-[#f0e3c4]/50 px-4 text-[13px] font-medium hover:bg-[#b8956a]/20"
			>
				Sign up with Google
			</button>
		</form>
	</div>

	<p class="mt-5 text-[13px] text-neutral-500">
		Already have an account?
		<a href="/sign-in" class="font-medium text-neutral-900 hover:text-[#5a4226] hover:underline">
			Sign in
		</a>
	</p>
</div>
