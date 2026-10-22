# Voice Helper

*For people who have trouble speaking. It follows the conversation, suggests replies, and says the one you tap out loud.*

![Voice Helper on a tablet, in demo mode. At the top, a short conversation: someone says they brought soup and asks whether to warm it up. Below are six large reply buttons, such as Yes please, that sounds wonderful, and Maybe later, I am not hungry yet. Along the bottom are buttons to steer the replies, such as Yes, No and Ask a question, and a box for typing a word or two.](docs/screen.png)

**Try the demo: [markpikemarkpike.github.io/voice-helper](https://markpikemarkpike.github.io/voice-helper/)**

---

## The idea

I built the first version of this for my mom.

I noticed she was struggling to type out her replies, especially as her condition progressed and she lost dexterity. Spelling out an answer is slow, and conversations don't wait.

I realized it would be simpler if a generative AI model followed the conversation and suggested replies. She would still pick the direction of the conversation. And with a voice bank, it could be in her own voice.

So this follows both sides of the conversation.

1. **Someone talks.** The microphone stays on the whole time and turns what they say into text.
2. **It predicts six short replies** that fit what was just said. They show up one at a time, so the first is ready in a moment.
3. **You tap one and the device says it.** The microphone is covered while the device speaks, so it never hears itself. Then it goes back to listening.

If none of them is right, steer:

- Tap **Yes**, **No**, **Ask a question**, **Say more**, **Change the subject** or **I need something**, and all six replies go that way. (The demo only knows the first three.)
- Or type a word or two, like "tired" or "after lunch", and it turns that into full sentences to pick from.
- Or type the whole thing and tap **Say this**.

With a keyboard, or a switch set up to press keys, **1** to **6** say the reply in that place. You can turn that off in Settings.

### Your own voice

A computer voice is not your voice. Some people bank their voice while they can, or have a copy of it made from old recordings.

If yours is at ElevenLabs, tap **Use your own voice**, paste your own ElevenLabs API key, and pick your voice. Replies are then spoken in it. If the service can't be reached, the device's voice speaks, so you are never left silent.

- Make a key just for this. Limit it to text to speech and reading voices, and give it a credit limit. ElevenLabs advises developers not to put keys in browser code. Here it is your own key, on your own device, and a limited key caps the damage.
- **Only use a voice that is yours, or that you have permission to use.**
- This page doesn't record, copy or keep anyone's voice. Making the voice happens at the service, not here.
- As far as I can tell, Apple's Personal Voice works in apps but not on web pages, so it can't be used here.

Note: I'm a non-technical lawyer. I can't really code. I built this with [Claude Code](https://claude.com/claude-code). Full disclosure: I work at Anthropic, which makes Claude. This is a personal project, not an Anthropic product.

## Please read this

- **Tell people the device is listening.** Once started, the microphone stays on and turns nearby speech into text. Ask first.
- **The replies are guesses.** Read before you tap. It can get things wrong, and it is speaking for a person.
- **This is a hobby project.** It has not been reviewed, cleared or tested as a medical device, and the code has had no security audit. A speech-language pathologist can tell you what will really suit a particular person.

## Trying it

The link above opens in demo mode. The conversation and the replies are a script, so it doesn't listen and there's nothing to set up. It speaks in your device's usual voice. The page makes no requests of its own. Tap **Next line**, then tap a reply.

## Using it for real

I don't run a working copy for everyone. Something has to write the replies, and you choose what. In **Settings**, under **Where replies come from**, pick **Claude** or **Other**.

### With Claude

This is what I built it with. It costs a little each time, and you bring your own key. An API key is a long secret code that lets a program use your account.

1. Make an account at [platform.claude.com](https://platform.claude.com/). Add only a little credit, and leave automatic top-ups off.
2. Create an API key just for this.
3. In Voice Helper, open **Settings**, paste the key, and tap **Use this key**. Tick **Remember it on this device** if you don't want to paste it every visit, and read the note below first.
4. Choose a model. Smaller models answer faster and cost less, and speed matters more than polish here.
5. Fill in **About me**, so the replies sound like the person.
6. Close Settings. It starts listening, and keeps listening until you tap to stop.

You are using your own Anthropic account, under its terms, and you pay for what you use.

### With something else

**Other** works with any service or program that answers in the common "chat completions" format. That includes free models that run on your own computer, which need no key and cost nothing.

1. In **Settings**, choose **Other**.
2. Type the address. For a program on the same computer it looks like `http://localhost:11434/v1`.
3. Paste a key if it needs one, and tap **Connect**.
4. Choose a model. If none are listed, type the model's name.

Things to know:

- **Only type an address you trust.** Whoever answers there gets the key, the conversation and About me. Settings shows you where they are about to go.
- The address has to start with `https://`. Plain `http://` is allowed only for `localhost`, meaning a program on the same computer as the page.
- So a tablet can't use a model running on another computer in the house. Run the page on the computer that runs the model.
- The program has to allow web pages to call it. Look for a setting about allowed origins, or CORS. Some browsers also ask permission, or refuse, when a website calls a program on your computer. If so, run the page from `localhost` too, as shown under Changing the code.
- Small models are quicker to get things wrong. They may ignore the rules in `core.js` about not inventing facts. Read before you tap.
- A key is tied to the place you typed it for. Switch between Claude and Other, or connect to a new address, and the old key is forgotten first.

**What it costs.** Each set of replies is one small request, and each thing it hears sets one off. The page shows how many it has made. To keep a television or a busy room from running up a bill, it waits for a pause before asking, never asks more than once a second, and after 8 requests in a row with nobody tapping it keeps listening but stops asking until someone taps.

Listening usually works in Chrome, Edge and Safari, but it depends on the browser and the device. On an iPad or iPhone it may need Dictation turned on. Where listening doesn't work, type what the other person said.

Settings belong to one browser on one device. On a tablet, add the page to the home screen first, then set it up there.

## Where everything goes

There are no accounts, no ads, no cookies and no tracking. I run no server and collect nothing.

| What | Where it goes |
|---|---|
| Your API key | Stays in the page's memory and is forgotten when you close it. It is sent only to the place you typed it for: Anthropic, or your address under Other. If you tick **Remember it on this device**, it is kept in your browser's storage. |
| The conversation | Never saved by this page. Gone when you close it. Once set up, the last 12 lines are sent to Anthropic, or to your address under Other, with each request, along with any word you typed and the button you steered with. |
| What the microphone hears | Turned into text by your browser. The browser's maker may do that on its own servers. |
| About me | Kept in your browser. Sent along with each request. |
| Your ElevenLabs key, if you set up your own voice | Same rules as the other key. It is sent only to ElevenLabs. |
| The words of each reply you tap, if you set up your own voice | Sent to ElevenLabs, which sends back the sound. The sound is played and not kept. The rest of the conversation is not sent there. |
| The page itself | Served by GitHub, which sees your internet address, as any website does. |

A voice marked "needs internet" in Settings sends the words to whoever makes that voice.

What Anthropic, ElevenLabs, GitHub, your browser's maker and anyone you choose under Other do with what they receive is up to their own terms and privacy policies. This page has no say in it.

**About remembering a key.** Other pages hosted at the same web address could read a remembered key. That is true of my copy and of any copy you host beside other sites. Leaving the box unticked is safer. An account with only a little credit on it caps the damage either way.

## Changing the code

There's nothing to install and nothing to build.

| File | What it is |
|---|---|
| `core.js` | The instructions sent with each request, how the answer is read, the demo script. Start here. |
| `app.js` | Everything you see, hear and tap. |
| `style.css` | How it looks. |
| `index.html` | The page and its pop-ups. |
| `test.js` | Checks for `core.js`. Run `node test.js`. |

To run it on your own computer:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Edit a file, save, reload. Browsers only allow the microphone on `localhost` or over HTTPS.

`test.js` covers `core.js` only. `app.js` has no tests in this repo.

No model is named anywhere in the code. The page asks the service which models your key can use and lets you pick.

The wording that shapes the replies is `SYSTEM` in `core.js`. It's plain English. Change it and see what happens.

To put up your own copy, fork this repo and turn on GitHub Pages in Settings. Never put a key in the code.

## Ways to make it better

I'd love help with any of these. Pull requests are welcome.

- **More ways to use your own voice.** Only one voice service works here so far. Others, or a voice model that runs on the device, would be welcome.
- **Learning.** Remember which replies get picked, on the device, and lean that way.
- **Telling speakers apart**, for a room with more than two people.
- **Listening on the device**, so that no audio leaves it.
- **Better switch, dwell and eye-gaze access**, for people who can't tap. Number keys are a start.
- **Other languages.**
- **Testing with people who would use it**, and with the people who care for them.

## License

MIT. See [LICENSE](LICENSE).

If this helps someone you love, I'd like to hear about it. Open an issue on this repo. Issues are public, so leave out anything private.

*Claude is a trademark of Anthropic, PBC. I work there, but this is a personal project. It is not affiliated with or endorsed by ElevenLabs.*
