
#Changelog

### v.2.2.2
* Small fixes after migrating the extension to the new name.

### v.2.2.1
* **Please check the new [online Viper tutorial](http://viper.ethz.ch/tutorial/).**
* Caching is now enabled by default. The cache is stored separately for different verification backends.

### v.2.1.1
* **Please update the IDE dependencies via Command Palette in order to use this version.**
* Fixed the bug that caused some verification failures to appear twice when caching is enabled.
* The new ViperServer supports caching of verification results for both verification backends. The caching mechanism is optimized.

### v.2.1.0
* **Please update the IDE dependencies via Command Palette in order to use this version.**
* Fixed the bug causing the bottom pane to pop-up at startup or while navigating the code, jumping to definition, etc.
* The new ViperServer supports caching of verification results from Silicon.
* Caching is disabled by default for now. To enable caching, add the following to your User Settings:

        "viperSettings.viperServerSettings": {
            "v": "674a514867b1",
            "disableCaching": false
        }

    To invalidate the cache, use ```Viper: flush the cache``` from the command palette.


### v.2.0.10
* Fixed a bug with internal errors not being reported properly (e.g., ```"tag": "internal:feature.unsupported"```). See [Silicon#326](https://bitbucket.org/viperproject/silicon/issues/326)
* Fixed a bug with error reporting in custom backends (```"type": "other"```).
* Changed the extension category to an appropriate one (Programming Languages). Thanks to Greg Van Liew <gregvanl@microsoft.com> for pointing that out!

### v.2.0.9
* **Please update the IDE dependencies via Command Palette in order to use this version.**
* The new ViperServer avoids race conditions in HTTP router.
* ViperServer's log file location is now written to the output panel.
* Exceptional messages from ViperServer are now supported by the IDE.
* Custom verification backends can now be used with ViperIDE/ViperServer.
    Just add the following element to ```"viperSettings.verificationBackends"``` in User Settings:

        {
            "v": "674a514867b1",
            "name": "my_custom_backend",
            "type": "other",
            "paths": [],
            "engine": "ViperServer",
            "timeout": 20000,
            "stages": [
                {
                    "name": "verify",
                    "isVerification": true,
                    "mainMethod": "core.MyCustomVerificationBackend",
                    "customArguments": "--z3Exe $z3Exe$ $disableCaching$ $fileToVerify$"
                }
            ],
            "stoppingTimeout": 5000
        }

    ```core.MyCustomVerificationBackend``` must be a class that extends [SilFrontend](https://bitbucket.org/viperproject/silver/src/3d835cb8e183249aefd761bccbc523e1adcfb8c3/src/main/scala/viper/silver/frontend/SilFrontend.scala?at=default&fileviewer=file-view-default)
    that exists in a reachable JAR file (you have to manually add it to
    ```$viperToolsPath/Viper/backends``` manually).

### v.2.0.7
* Arbitrary-large input programs are supported via JSON streaming.

### v.2.0.6
* Dynamic verification backends can be specified for the ViperServer engine.


# Documentation

[Wiki](https://bitbucket.org/viperproject/viper-ide/wiki/browse/)

[Project page](http://viper.ethz.ch)

[Installing and uninstalling ViperIDE](http://viper.ethz.ch/downloads)
