import { describe } from 'mocha';
import { should } from 'chai';

import * as AdoptOpenJDKApi from './adopt-openjdk-api';

should();

describe('adopt-openjdk-api', function () {

    describe('fetch', function () {
        const osList: OsType[] = ['windows', 'linux', 'mac'];
        const jvmList: JvmType[] = ['hotspot', 'openj9'];
        const jdkVersions = [8, 11, 15];
        const archList: ArchitectureType[] = ['x64', 'x86'];

        osList.forEach(os => {
            jvmList.forEach(jvm => {
                jdkVersions.forEach(version => {
                    archList.forEach(arch => {
                        const testName = `jdk${version}-${os}-${jvm}-${arch}`;
                        it(testName, async function () {
                            this.timeout(10000);
                            this.retries(2);
                            const entries = await AdoptOpenJDKApi.fetch(os, jvm, version, arch);
                            if (arch === 'x64' && jvm === 'hotspot') {
                                entries.length.should.greaterThan(0);
                            }
                            entries.forEach(
                                entry => {
                                    try {
                                        entry.release_name.should.not.be.empty;
                                        entry.os.should.equal(os);
                                        entry.architecture.should.equal(arch);
                                        entry.jvm_impl.should.equal(jvm);
                                    } catch (error) {
                                        console.error(entry);
                                        throw error;
                                    }
                                });
                        });
                    });
                });
            });
        });
    });

    describe('filter', function () {
        this.retries(2);

        it('jdk-11.0.12+7-openj9', async function () {
            const entries = await AdoptOpenJDKApi.fetch('windows', 'openj9', 11, 'x64');
            entries.length.should.greaterThan(0);
            const found = AdoptOpenJDKApi.filter(entries, 'jdk-11.0.12+7');
            found.release_name.should.equal('jdk-11.0.12+7_openj9-0.27.0');
        });

        it('jdk-11-latest-openj9', async function () {
            const entries = await AdoptOpenJDKApi.fetch('windows', 'openj9', 11, 'x64');
            entries.length.should.greaterThan(0);
            const found = AdoptOpenJDKApi.filter(entries, '');
            found.release_name.should.not.empty;
        });
    });

});
