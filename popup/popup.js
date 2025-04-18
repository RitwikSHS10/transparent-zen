class ExtensionPopup {
	BROWSER_STORAGE_KEY = "transparentZenSettings";
	browserStorageSettings = {};
	extensionSettingsForm = document.getElementById("extension-settings");
	supportedWebsitesArea = document.getElementById("supported-websites");

	constructor() {
		this.loadSettings().then((settings) => {
			if (settings) {
				this.browserStorageSettings = settings;
				this.restoreSettings();
				this.bindEvents();
				this.getSupportedWebsites();
			}
		});
	}

	bindEvents() {
		for (const input of this.extensionSettingsForm.querySelectorAll("input")) {
			this.toggleDependantSettings(input);
			input.addEventListener("change", async () => {
				if (input.name === "enable-transparency") {
					this.sendMessageToActiveTabs({ action: "toggleTransparency", enabled: input.checked });
				}
				if (input.name === "blacklist-domain") {
					await this.toggleDomainBlacklist(input.checked);
					this.sendMessageToActiveTabs({ action: "toggleTransparency", enabled: !input.checked });
				}
				if (input.name === "text-color") {
					this.sendMessageToActiveTabs({ action: "changeTextColor", value: input.value });
					input.style.borderLeftColor = input.value || input.placeholder;
				}
				if (input.name === "primary-color") {
					this.sendMessageToActiveTabs({ action: "changePrimaryColor", value: input.value });
					input.style.borderLeftColor = input.value || input.placeholder;
				}
				if (input.name === "background-color") {
					this.sendMessageToActiveTabs({ action: "changeBackgroundColor", value: input.value });
					input.style.borderLeftColor = input.value || input.placeholder;
				}
				this.toggleDependantSettings(input);
				this.saveSettings();
			});
		}

		const showAllButton = this.supportedWebsitesArea.querySelector(".show-all");
		showAllButton?.addEventListener("click", () => {
			const target = this.supportedWebsitesArea.querySelector(`[data-content=${showAllButton.dataset.target}]`);
			if (target) {
				target.classList.toggle("open");
				showAllButton.remove();
			}
		});
	}

	async getContentScripts() {
		const response = await fetch("../data/ContentScripts.json");
		if (response.ok) {
			return response.json();
		}
		return false;
	}

	async getSupportedWebsites() {
		this.browserStorageSettings.disabledWebsites ??= [];
		const contentScripts = await this.getContentScripts();
		if (!contentScripts) {
			return;
		}

		const supportedWebsitesList = this.supportedWebsitesArea.querySelector("[data-content=supported-sites]");
		for (const website of contentScripts.supportedWebsites) {
			const listElement = document.createElement("li");
			listElement.textContent = website.name;

			const toggleButton = document.createElement("button");
			const disabledWebsiteIndex = this.browserStorageSettings.disabledWebsites.findIndex((site) => site.name === website.name);
			if (disabledWebsiteIndex >= 0) {
				toggleButton.classList.remove("active");
			} else {
				toggleButton.classList.add("active");
			}

			toggleButton.addEventListener("click", () => {
				if (toggleButton.classList.contains("active")) {
					this.browserStorageSettings.disabledWebsites.push(website);
					browser.runtime.sendMessage({ action: "removeStyles", filePath: website.css[0] });
					toggleButton.classList.remove("active");
				} else {
					this.browserStorageSettings.disabledWebsites.splice(disabledWebsiteIndex, 1);
					console.log(website);
					browser.runtime.sendMessage({ action: "insertStyles", filePath: website.css[0], domains: website.matches });
					toggleButton.classList.add("active");
				}

				browser.storage.local.set({ [this.BROWSER_STORAGE_KEY]: this.browserStorageSettings });
				this.sendMessageToActiveTabs({ action: "updateSettings" });
				console.info("Settings saved", this.browserStorageSettings);
			});

			listElement.appendChild(toggleButton);
			supportedWebsitesList.appendChild(listElement);
		}
	}

	toggleDependantSettings(input) {
		const dependantSettings = document.querySelector(`[data-depends-on="${input.name}"]`);
		if (dependantSettings) {
			input.checked ? dependantSettings.classList.add("visible") : dependantSettings.classList.remove("visible");
		}
	}

	async restoreSettings() {
		if (this.extensionSettingsForm?.elements) {
			for (const element of this.extensionSettingsForm.elements) {
				if (this.browserStorageSettings[element.name]) {
					switch (element.type) {
						case "checkbox":
							if (element.name === "blacklist-domain") {
								const domain = await this.getActivePageDomain();
								element.checked = this.browserStorageSettings.blacklistedDomains.indexOf(domain) >= 0;
							} else {
								element.checked = JSON.parse(this.browserStorageSettings[element.name]);
							}
							break;
						case "text":
						case "number":
							element.value = this.browserStorageSettings[element.name];
							break;
					}

					switch (element.name) {
						case "text-color":
						case "primary-color":
						case "background-color":
							element.style.borderLeftColor = this.browserStorageSettings[element.name];
							break;
					}
				}
			}
		}
	}

	async loadSettings() {
		const settings = await browser.storage.local.get(this.BROWSER_STORAGE_KEY);
		console.info("Settings loaded", settings?.[this.BROWSER_STORAGE_KEY]);
		return settings?.[this.BROWSER_STORAGE_KEY] || {};
	}

	saveSettings() {
		if (this.extensionSettingsForm?.elements) {
			for (const element of this.extensionSettingsForm.elements) {
				switch (element.type) {
					case "checkbox":
						this.browserStorageSettings[element.name] = element.checked;
						break;
					case "text":
					case "number":
						this.browserStorageSettings[element.name] = element.value;
						break;
				}
			}

			browser.storage.local.set({ [this.BROWSER_STORAGE_KEY]: this.browserStorageSettings });
			this.sendMessageToActiveTabs({ action: "updateSettings" });
			console.info("Settings saved", this.browserStorageSettings);
		}
	}

	async sendMessageToActiveTabs(message) {
		const tabs = await browser.tabs.query({
			currentWindow: true,
			active: true,
		});

		const responses = await Promise.all(
			tabs.map(async (tab) => {
				const response = await browser.tabs.sendMessage(tab.id, message);
				return { tabId: tab.id, response };
			}),
		);

		return responses;
	}

	async getActivePageDomain() {
		const tabResponses = await this.sendMessageToActiveTabs({ action: "getDomain" });
		return tabResponses?.[0]?.response;
	}

	async toggleDomainBlacklist(enabled) {
		this.browserStorageSettings.blacklistedDomains ??= [];

		const domain = await this.getActivePageDomain();
		const indexOfDomain = this.browserStorageSettings.blacklistedDomains.indexOf(domain);

		if (enabled) {
			indexOfDomain === -1 && this.browserStorageSettings.blacklistedDomains.push(domain);
		} else {
			this.browserStorageSettings.blacklistedDomains.splice(indexOfDomain, 1);
		}
	}
}

new ExtensionPopup();
