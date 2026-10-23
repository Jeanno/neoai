# Navi for Raycast

Ask an AI from anywhere on your Mac. Navi can run on a model on your own
computer, so your questions stay private, or on a provider you choose with
your own key.

## 1. Install Raycast

Skip this if you already have Raycast.

1. Go to [raycast.com](https://raycast.com) and click **Download**.
2. Open the downloaded file and drag **Raycast** into **Applications**.
3. Open Raycast and follow the welcome steps. Pick a keyboard shortcut to open
   it (the default is **⌥ Space**, Option + Space).

## 2. Install Navi

1. Open **Terminal** (press **⌘ Space**, type **Terminal**, press **Return**).
2. Copy this line, paste it into Terminal, and press **Return**:

   ```
   curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/jackins/raycast/install.sh | sh
   ```

3. When it says **Added to Raycast**, you can close Terminal.

Navi isn't in the Raycast Store, so Raycast lists it as a development
extension. That's expected. To update Navi later, run the same line again.

## 3. Give Navi a model to use

Navi needs an AI model to answer with. Open Raycast, type **Set Up Navi** and
press **Return**. It shows the model Navi uses now (the **Primary**) and a
**Fallback** to try when the primary can't answer. Choose one and press
**Return** to change it, then pick from:

- **Local** — a model on your Mac. Nothing leaves your computer.
- **Providers** — a hosted model, using your own key from that provider. Set Up
  Navi links to the page where you create the key, and checks it before saving.
- **Custom** — your own server, if it speaks the OpenAI API.

After each change Navi asks the model a short test question and shows the
reply, so you know it works. The choice is shared with `navi` in Terminal.

**A model on your Mac.** The easiest way to get one is LM Studio, a free app
that runs models on your Mac.

1. Go to [lmstudio.ai](https://lmstudio.ai), download LM Studio, and drag it
   into **Applications**.
2. Open LM Studio. In the **Discover** tab (the magnifying glass), download one
   of the models it recommends. Smaller models answer faster; a 4B or 8B model
   is a good start.
3. Open the **Developer** tab and switch the server on, so the status reads
   **Running**.
4. Open **Set Up Navi**. Until you choose otherwise, the primary is any model
   on your Mac, so it should now say which one answers. To pick a particular
   model, choose **Primary**, then **Local**; if yours isn't listed yet, press
   **⌘ R** to check again.

LM Studio has to be open with its server running whenever you use Navi. In
LM Studio's settings you can have it start when you log in.

> Already use Ollama or another local AI app? Navi finds those too.

## 4. Ask something

- **Ask Navi** — a quick question. Open Raycast, type **Ask Navi**, press
  **Tab**, type your question, and press **Return**.
- **Ask About Selected Files** — select images, PDFs or text files in
  Finder, open Raycast, type **Ask About Selected Files**, press **Tab**, type
  your question (or leave it empty to have them described), and press
  **Return**.
- **Navi Chat** — a conversation you can come back to. Open Raycast, type
  **Navi Chat**, choose **New Chat**, type, and press **Return**.
- **Fix Spelling and Grammar** — select some text in any app, open Raycast,
  type **Fix Spelling and Grammar**, and press **Return**. Navi fixes the
  mistakes and puts the corrected text in place of what you selected.
- **Translate and Replace** — the same, but swaps the selected text for a
  translation. It translates into English unless you choose another language
  under **Translate To** in Navi's settings (Raycast settings, **⌘ ,**, then
  **Extensions** and **Navi**).
- **Summarize** — select some text, or copy it, then open Raycast and type
  **Summarize**. Navi shows a short summary you can copy or paste.

These can take a few seconds while the model works; a small message at the
bottom of the screen shows Navi is busy.

**Ask Navi**, **Navi Chat** and **Summarize** can look things up while they
answer: search the web, look through files, or run a command, working in a
folder of its own (`~/.navi-raycast`). Each step shows as a short line above
the answer. Before Navi runs a command
that could change something, it stops and shows you the command: choose
**Run Command** to let it, or **Don't Run** (**⌘ D**). Before it changes a
file it shows the change, with **Write File** and **Don't Write**. Leaving
the answer or stopping it also means no.

While an answer or summary is showing:

| Keys       | What it does                       |
| ---------- | ---------------------------------- |
| **Return** | Copy the answer                    |
| **⌘ J**    | Continue as a chat (Ask Navi only) |
| **⌘ R**    | Ask again for a different answer   |
| **⌘ ⇧ .**  | Stop the answer                    |

Ask Navi and Summarize show which model replied beside the answer, under
**Model**. If it says **(remote)**, your text was sent to the provider you
chose rather than handled on your Mac.

**Tips**

- Give **Fix Spelling and Grammar** its own keyboard shortcut so you can fix
  text without opening Raycast: open Raycast's settings (**⌘ ,**), go to
  **Extensions**, find **Fix Spelling and Grammar** under Navi, click
  **Record Hotkey**, and press the keys you want, such as **⌥ ⌘ G**.
- Make **Ask Navi** a fallback command, so anything you type in Raycast that
  doesn't match a command can go straight to Navi. Type something Raycast
  doesn't recognise, look at the list under **Use … with…** at the bottom,
  press **⌘ K**, choose **Manage Fallback Commands**, and add **Ask Navi**.

## Something not working?

**"Navi has no model to answer with"**
None of the models chosen in Set Up Navi answered. Press **Return** to open
**Set Up Navi** and choose another, or, for a model on your Mac, open LM
Studio, make sure a model is downloaded and the server says **Running**, then
ask again.

**Answers are slow**
The first question after opening LM Studio is slower while the model loads. If
it's always slow, download a smaller model in LM Studio.

**Navi doesn't appear in Raycast**
Run the install line from step 2 again. If it says Raycast couldn't be
reached, open Raycast first, then run it once more.
