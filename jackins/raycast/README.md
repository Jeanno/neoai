# Navi for Raycast

Ask an AI from anywhere on your Mac. Navi runs on a model on your own computer,
so your questions stay private and it costs nothing.

## 1. Install Raycast

Skip this if you already have Raycast.

1. Go to [raycast.com](https://raycast.com) and click **Download**.
2. Open the downloaded file and drag **Raycast** into **Applications**.
3. Open Raycast and follow the welcome steps. Pick a keyboard shortcut to open
   it (the default is **⌥ Space**, Option + Space).

## 2. Install Navi

1. Open Raycast with your shortcut.
2. Type **Store** and press **Return**.
3. Search for **Navi** and press **Return** to install it.

## 3. Give Navi a model to use

Navi needs an AI model to answer with. The easiest way to get one is LM Studio,
a free app that runs models on your Mac.

1. Go to [lmstudio.ai](https://lmstudio.ai), download LM Studio, and drag it
   into **Applications**.
2. Open LM Studio. In the **Discover** tab (the magnifying glass), download one
   of the models it recommends. Smaller models answer faster; a 4B or 8B model
   is a good start.
3. Open the **Developer** tab and switch the server on, so the status reads
   **Running**.

Navi finds LM Studio by itself. There is nothing to type in or set up.

LM Studio has to be open with its server running whenever you use Navi. In
LM Studio's settings you can have it start when you log in.

> Already use Ollama, Darkbloom or another local AI app? Navi finds those too.

## 4. Ask something

- **Ask Navi** — a quick question. Open Raycast, type **Ask Navi**, press
  **Tab**, type your question, and press **Return**.
- **Navi Chat** — a conversation you can come back to. Open Raycast, type
  **Navi Chat**, choose **New Chat**, type, and press **Return**.

While an answer is showing:

| Keys | What it does |
| --- | --- |
| **Return** | Copy the answer |
| **⌘ J** | Continue as a chat |
| **⌘ R** | Ask again for a different answer |
| **⌘ ⇧ .** | Stop the answer |

Ask Navi shows which model replied beside the answer, under **Model**. If it
says **(remote)**, your question was sent over the internet rather than
answered on your Mac.

## Something not working?

**"No model found"**
Navi couldn't find a model. Open LM Studio, make sure a model is downloaded and
the server says **Running**, then ask again. If you also use navi in Terminal,
running `navi setup` there walks you through the other choices.

**Answers are slow**
The first question after opening LM Studio is slower while the model loads. If
it's always slow, download a smaller model in LM Studio.

**Navi doesn't appear in Raycast**
Open Raycast, type **Store**, search for **Navi**, and check it says
**Installed**.
