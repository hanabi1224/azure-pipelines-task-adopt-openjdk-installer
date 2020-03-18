import * as path from 'path';
import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';
import * as AdoptOpenJDKApi from './adopt-openjdk-api';
import { promisify } from 'util';
import { exec } from 'child_process';

taskLib.setResourcePath(path.join(__dirname, 'task.json'));

async function runInner(jdkRoot: string, os: OsType, arch: ArchitectureType, jvm: JvmType, majorVersion: number, versionFilter: string, useCache: boolean) {
    const entries = await AdoptOpenJDKApi.fetch(os, jvm, majorVersion, arch);
    if (!entries || entries.length <= 0) {
        throw 'Unable to find a matching version.';
    }
    const found = AdoptOpenJDKApi.filter(entries, versionFilter);
    if (!found) {
        throw 'Unable to find a matching version.';
    }

    const jdkDirectory = await AdoptOpenJDKApi.downloadAndChecksum(found, jdkRoot, useCache);
    const extendedJavaHome = `JAVA_HOME_${majorVersion}_${arch.toUpperCase()}`;
    console.log(`Setting JAVA_HOME to ${jdkDirectory}`);
    console.log(taskLib.loc(`Setting ${extendedJavaHome} to ${jdkDirectory}`));
    taskLib.setVariable('JAVA_HOME', jdkDirectory);
    taskLib.setVariable(extendedJavaHome, jdkDirectory);
    const binPath = path.join(jdkDirectory, 'bin')
    toolLib.prependPath(binPath);

    const execAsync = promisify(exec);
    const p = await execAsync('java -version');
    if (p?.stdout) {
        console.log(p.stdout);
    }
    if (p?.stderr) {
        console.error(p.stderr);
    }
}

async function run() {
    const os = AdoptOpenJDKApi.detectOS();
    const jdkRoot = path.join(taskLib.getVariable('Agent.ToolsDirectory'), "jdk");
    const arch = taskLib.getInput('jdkArchitectureOption', true).toLowerCase() as ArchitectureType;
    const jvm = taskLib.getInput('jvmOption', true) as JvmType;
    const majorVersion = parseInt(taskLib.getInput('majorVersion', true));
    const useLatestOption = taskLib.getInput('useLatestOption', true) as 'latest' | 'specific';
    const useLatest = useLatestOption === 'latest';
    const useCacheStr = taskLib.getInput('useCacheOption', false);
    const useCache = useCacheStr && useCacheStr.toLowerCase() === 'true';
    let versionFilter = '';
    if (!useLatest) {
        versionFilter = taskLib.getInput('versionFilter', true).toLowerCase().trim();
    }
    await runInner(jdkRoot, os, arch, jvm, majorVersion, versionFilter, useCache);
}

taskLib.setVariable('Agent.TempDirectory', path.join(__dirname, 'temp'));
taskLib.setVariable('Agent.ToolsDirectory', path.join(__dirname, 'jdk'));
runInner(path.join(__dirname, 'jdk'), AdoptOpenJDKApi.detectOS(), 'x64', 'hotspot', 11, '', true);
